import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IPty, IPtyForkOptions } from "node-pty";
import { CHAT_OUT_END, CHAT_OUT_START, parseChatOutSentinel, stripShellFence } from "./transcript.js";

export type ShellRunResult = {
  command: string;
  output: string;
  chatOut?: string;
  timedOut: boolean;
  elapsedMs: number;
  lastOutput: string;
  exitCode?: number;
};

export type ShellRunnerOptions = {
  cwd: string;
  shell: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
};

export type ShellRunner = {
  run(command: string, timeoutMs: number): Promise<ShellRunResult>;
  kill(): void;
  readonly helpersPath: string;
};

type PtyModule = {
  spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
};

const PROMPT = "__SMITH_PROMPT__ ";
const EXIT_STATUS_START = "__SMITH_EXIT_STATUS_START__";
const EXIT_STATUS_END = "__SMITH_EXIT_STATUS_END__";
const EXIT_STATUS_COMMAND =
  "printf '\\n%s%s%s\\n' \"$SMITH_EXIT_STATUS_START\" \"$?\" \"$SMITH_EXIT_STATUS_END\"";

export class PtyShellRunner implements ShellRunner {
  private readonly terminal: IPty;
  private readonly helperDir: string;
  private buffer = "";
  private closed = false;

  private constructor(terminal: IPty, helperDir: string) {
    this.terminal = terminal;
    this.helperDir = helperDir;
    this.terminal.onData((data) => {
      this.buffer += data;
    });
    this.terminal.onExit(() => {
      this.closed = true;
    });
  }

  static async start(options: ShellRunnerOptions): Promise<ShellRunner> {
    const helperDir = createHelperDir();
    const pty = await loadPtyModule(options.env);
    if (!pty) return new BasicShellRunner(options, helperDir);

    const terminal = pty.spawn(options.shell, ["--noprofile", "--norc", "-i"], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        PATH: `${helperDir}:${options.env?.PATH ?? process.env.PATH ?? ""}`,
        PS1: PROMPT,
        SMITH_EXIT_STATUS_START: EXIT_STATUS_START,
        SMITH_EXIT_STATUS_END: EXIT_STATUS_END
      }
    });
    const runner = new PtyShellRunner(terminal, helperDir);
    await runner.waitForPrompt(options.timeoutMs);
    runner.buffer = "";
    return runner;
  }

  async run(command: string, timeoutMs: number): Promise<ShellRunResult> {
    if (this.closed) throw new Error("shell is closed");
    const cleaned = stripShellFence(command).trimEnd();
    this.buffer = "";
    await sleep(25);
    this.buffer = "";
    const started = Date.now();
    const sent = wrapInteractiveShellCommand(cleaned);
    this.terminal.write(`${sent}\r`);
    const wait = await this.waitForPromptOrChatOut(timeoutMs);
    if (wait === "timeout" && !this.closed) {
      this.terminal.write("\x03");
      await this.waitForPrompt(1000);
    } else if (wait === "prompt") {
      this.terminal.write(`${EXIT_STATUS_COMMAND}\r`);
      await this.waitFor(() => this.buffer.includes(EXIT_STATUS_END) && this.buffer.includes(PROMPT), 1000);
    }
    const parsed = parseChatOutSentinel(this.buffer);
    const status = parseExitStatusSentinel(parsed.output);
    const output = stripEchoedCommand(normalizePtyOutput(status.output), sent);
    return {
      command: cleaned,
      output,
      chatOut: parsed.chatOut,
      timedOut: wait === "timeout",
      elapsedMs: Date.now() - started,
      lastOutput: tail(output, 1200),
      ...(status.exitCode !== undefined ? { exitCode: status.exitCode } : {})
    };
  }

  kill(): void {
    this.terminal.kill();
    rmSync(this.helperDir, { recursive: true, force: true });
  }

  get helpersPath(): string {
    return this.helperDir;
  }

  private async waitForPrompt(timeoutMs: number): Promise<void> {
    await this.waitFor(() => this.buffer.includes(PROMPT), timeoutMs);
  }

  private async waitForPromptOrChatOut(timeoutMs: number): Promise<"prompt" | "chat_out" | "timeout"> {
    return this.waitFor(() => {
      if (this.buffer.includes(CHAT_OUT_START) && this.buffer.includes(CHAT_OUT_END)) return "chat_out";
      if (this.buffer.includes(PROMPT)) return "prompt";
      return undefined;
    }, timeoutMs);
  }

  private waitFor<T>(predicate: () => T | undefined, timeoutMs: number): Promise<T | "timeout"> {
    return new Promise((resolve) => {
      const started = Date.now();
      const interval = setInterval(() => {
        const result = predicate();
        if (result !== undefined) {
          clearInterval(interval);
          resolve(result);
          return;
        }
        if (this.closed || Date.now() - started >= timeoutMs) {
          clearInterval(interval);
          resolve("timeout");
        }
      }, 10);
    });
  }
}

class BasicShellRunner implements ShellRunner {
  private readonly options: ShellRunnerOptions;
  private readonly helperDir: string;

  constructor(options: ShellRunnerOptions, helperDir: string) {
    this.options = options;
    this.helperDir = helperDir;
  }

  async run(command: string, timeoutMs: number): Promise<ShellRunResult> {
    const cleaned = stripShellFence(command).trimEnd();
    const started = Date.now();
    const env = {
      ...process.env,
      ...this.options.env,
      PATH: `${this.helperDir}:${this.options.env?.PATH ?? process.env.PATH ?? ""}`
    };
    const result = await execShell(this.options.shell, cleaned, {
      cwd: this.options.cwd,
      env,
      timeoutMs
    });
    const parsed = parseChatOutSentinel(result.output);
    const output = normalizePtyOutput(parsed.output);
    return {
      command: cleaned,
      output,
      chatOut: parsed.chatOut,
      timedOut: result.timedOut,
      elapsedMs: Date.now() - started,
      lastOutput: tail(output, 1200),
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {})
    };
  }

  kill(): void {
    rmSync(this.helperDir, { recursive: true, force: true });
  }

  get helpersPath(): string {
    return this.helperDir;
  }
}

function execShell(
  shell: string,
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<{ output: string; timedOut: boolean; exitCode?: number }> {
  return new Promise((resolve) => {
    execFile(
      shell,
      ["--noprofile", "--norc", "-lc", command],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : "");
        const exitCode = typeof error?.code === "number" ? error.code : error ? undefined : 0;
        resolve({
          output,
          timedOut: Boolean(error?.killed && error.signal === "SIGTERM"),
          ...(exitCode !== undefined ? { exitCode } : {})
        });
      }
    );
  });
}

async function loadPtyModule(env: NodeJS.ProcessEnv | undefined): Promise<PtyModule | undefined> {
  if (env?.SMITH_FORCE_BASIC_SHELL === "1" || process.env.SMITH_FORCE_BASIC_SHELL === "1") return undefined;
  try {
    const loaded = await import("node-pty");
    const module = (loaded.default ?? loaded) as unknown;
    return isPtyModule(module) ? module : undefined;
  } catch {
    return undefined;
  }
}

function isPtyModule(value: unknown): value is PtyModule {
  return typeof value === "object" && value !== null && typeof (value as { spawn?: unknown }).spawn === "function";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function wrapInteractiveShellCommand(command: string): string {
  if (mayCloseInteractiveShell(command) || mayMutateInteractiveShellOptions(command)) {
    return command.includes("\n") ? `(\n${command}\n)` : `(${command})`;
  }
  return wrapMultilineCommand(command);
}

function mayCloseInteractiveShell(command: string): boolean {
  return /(?:^|[;&|()\n]\s*)exit(?:\s|$|[;&|)\n])/i.test(command);
}

function mayMutateInteractiveShellOptions(command: string): boolean {
  return /(?:^|[;&|()\n]\s*)set\s+[-+][A-Za-z]*e[A-Za-z]*(?:\s|$|[;&|)\n])/i.test(command);
}

function wrapMultilineCommand(command: string): string {
  return command.includes("\n") ? `{\n${command}\n}` : command;
}

function createHelperDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "smith-helpers-"));
  const patchCli = join(dirname(fileURLToPath(import.meta.url)), "patch-cli.js");
  writeExecutable(
    join(dir, "chat_out"),
    `#!/usr/bin/env bash
if [ "$#" -gt 0 ]; then
  msg="$*"
else
  msg="$(cat)"
fi
printf '%s\\n' "$msg"
printf '${CHAT_OUT_START}\\n%s\\n${CHAT_OUT_END}\\n' "$msg"
`
  );
  writeExecutable(
    join(dir, "smith_patch"),
    `#!/usr/bin/env bash
node ${JSON.stringify(patchCli)}
`
  );
  return dir;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function normalizePtyOutput(output: string): string {
  return output
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(EXIT_STATUS_COMMAND, "")
    .replaceAll(PROMPT, "")
    .trim();
}

function parseExitStatusSentinel(output: string): { output: string; exitCode?: number } {
  const start = output.lastIndexOf(EXIT_STATUS_START);
  const end = start === -1 ? -1 : output.indexOf(EXIT_STATUS_END, start + EXIT_STATUS_START.length);
  if (start === -1 || end === -1) return { output };
  const rawStatus = output.slice(start + EXIT_STATUS_START.length, end).trim();
  const exitCode = Number.parseInt(rawStatus, 10);
  const withoutStatus = `${output.slice(0, start)}${output.slice(end + EXIT_STATUS_END.length)}`.replace(
    EXIT_STATUS_COMMAND,
    ""
  );
  return {
    output: withoutStatus,
    ...(Number.isInteger(exitCode) ? { exitCode } : {})
  };
}

function stripEchoedCommand(output: string, command: string): string {
  const strippedMultiline = stripEchoedMultilineCommand(output, command);
  if (strippedMultiline !== undefined) return strippedMultiline;
  if (output === command) return "";
  return output.startsWith(`${command}\n`) ? output.slice(command.length + 1).trim() : output;
}

function stripEchoedMultilineCommand(output: string, command: string): string | undefined {
  const expected = command.split("\n");
  if (expected.length <= 1) return undefined;
  const lines = output.split("\n");
  let outputIndex = 0;
  let expectedIndex = 0;
  while (outputIndex < lines.length && expectedIndex < expected.length) {
    const line = lines[outputIndex].trimEnd();
    if (line.trim() === "") {
      outputIndex += 1;
      continue;
    }
    const withoutContinuationPrompt = line.startsWith("> ") ? line.slice(2) : line;
    if (withoutContinuationPrompt !== expected[expectedIndex]) return undefined;
    outputIndex += 1;
    expectedIndex += 1;
  }
  if (expectedIndex !== expected.length) return undefined;
  while (outputIndex < lines.length && lines[outputIndex].trim() === "") outputIndex += 1;
  return lines.slice(outputIndex).join("\n").trim();
}

function tail(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}
