import { mkdtempSync, writeFileSync } from "node:fs";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { CHAT_OUT_END, CHAT_OUT_START, parseChatOutSentinel, stripShellFence } from "./transcript.js";

export type ShellRunResult = {
  command: string;
  output: string;
  chatOut?: string;
  timedOut: boolean;
};

export type ShellRunnerOptions = {
  cwd: string;
  shell: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
};

const PROMPT = "__SMITH_PROMPT__ ";

export class PtyShellRunner {
  private readonly terminal: pty.IPty;
  private readonly helperDir: string;
  private buffer = "";
  private closed = false;

  private constructor(terminal: pty.IPty, helperDir: string) {
    this.terminal = terminal;
    this.helperDir = helperDir;
    this.terminal.onData((data) => {
      this.buffer += data;
    });
    this.terminal.onExit(() => {
      this.closed = true;
    });
  }

  static async start(options: ShellRunnerOptions): Promise<PtyShellRunner> {
    const helperDir = createHelperDir();
    const terminal = pty.spawn(options.shell, ["--noprofile", "--norc", "-i"], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        PATH: `${helperDir}:${options.env?.PATH ?? process.env.PATH ?? ""}`,
        PS1: PROMPT
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
    this.terminal.write(`${cleaned}\r`);
    const wait = await this.waitForPromptOrChatOut(timeoutMs);
    const parsed = parseChatOutSentinel(this.buffer);
    return {
      command: cleaned,
      output: normalizePtyOutput(parsed.output),
      chatOut: parsed.chatOut,
      timedOut: wait === "timeout"
    };
  }

  kill(): void {
    this.terminal.kill();
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
  return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replaceAll(PROMPT, "").trim();
}
