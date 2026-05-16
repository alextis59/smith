import { execFile, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { configuredLogDir, summarizeTrace, tracePathFromContainerPath, writeSessionLog } from "../session-log.js";

const execFileAsync = promisify(execFile);

export type BenchmarkTaskResult = {
  task: string;
  agent: BenchmarkAgent;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  traceDir: string;
  tracePath?: string;
  sandboxDir: string;
  usage?: BenchmarkUsage;
  verifier?: BenchmarkVerifierResult;
  logPath?: string;
};

export type BenchmarkAgent = "smith" | "codex";

export type BenchmarkUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export type BenchmarkVerifierResult = {
  command: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
};

export type BenchmarkRunOptions = {
  agent?: BenchmarkAgent;
  profile?: string;
  smithArgs?: string[];
  model?: string;
  reasoningEffort?: string;
  image?: string;
  timeoutMs?: number;
  keepSandbox?: boolean;
  cost?: BenchmarkCostRates;
  logDir?: string;
};

export type BenchmarkCostRates = {
  inputCostPerMillionTokens?: number;
  cachedInputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

export async function runBenchmarkPath(path: string, options: BenchmarkRunOptions = {}): Promise<BenchmarkTaskResult[]> {
  const taskPaths = discoverTasks(path);
  const results: BenchmarkTaskResult[] = [];
  for (const taskPath of taskPaths) {
    results.push(await runBenchmarkTask(taskPath, options));
  }
  return results;
}

export async function runBenchmarkTask(taskPath: string, options: BenchmarkRunOptions = {}): Promise<BenchmarkTaskResult> {
  const task = resolve(taskPath);
  validateBenchmarkTask(task);
  const agent = options.agent ?? "smith";
  const repoRoot = findRepoRoot();
  const sandboxRoot = join(repoRoot, ".smith-bench");
  mkdirSync(sandboxRoot, { recursive: true });
  const sandbox = mkdtempSync(join(sandboxRoot, "run-"));
  const taskCopy = join(sandbox, "task");
  const workspace = join(sandbox, "workspace");
  const home = join(sandbox, "home");
  mkdirSync(home, { recursive: true });
  cpSync(task, taskCopy, { recursive: true });
  cpSync(join(taskCopy, "workspace"), workspace, { recursive: true });

  if (agent === "codex") {
    return runCodexBenchmarkTask({ task, taskCopy, workspace, home, sandbox, options });
  }
  return runSmithBenchmarkTask({ task, taskCopy, workspace, home, sandbox, options, repoRoot });
}

type BenchmarkTaskContext = {
  task: string;
  taskCopy: string;
  workspace: string;
  home: string;
  sandbox: string;
  options: BenchmarkRunOptions;
};

async function runSmithBenchmarkTask(context: BenchmarkTaskContext & { repoRoot: string }): Promise<BenchmarkTaskResult> {
  const { task, taskCopy, workspace, home, sandbox, options, repoRoot } = context;
  const started = Date.now();
  const image = options.image ?? "node:22-bookworm";
  const profileArgs = options.profile ? ["--profile", options.profile] : [];
  const smithArgs = prepareSmithArgsForDocker(home, [...profileArgs, ...(options.smithArgs ?? [])]);
  const jsonArgs = ["--quiet", "--json"];
  const command = `node /smith/bin/smith.js --cwd /workspace ${[...smithArgs, ...jsonArgs].map(shellQuote).join(" ")} "$TASK"`;
  const script = [
    "set -euo pipefail",
    "mkdir -p /home/smith",
    "RESULT_DIR=/home/smith/benchmark-results",
    "mkdir -p \"$RESULT_DIR\"",
    "TASK=$(printf '%s\\n\\n' 'Complete this benchmark task in the current workspace.' 'Make only the file changes needed for the task. Do not modify files outside the workspace.' 'Inspect and edit files with shell commands. Do not call chat_out until the requested change is actually implemented and, when practical, checked.' 'The benchmark verifier is available at /task/verify.sh; run bash /task/verify.sh before chat_out unless blocked.' 'If files need to change, a response that only calls chat_out is a failed benchmark attempt.'; cat /task/Task.md)",
    "set +e",
    `${command} > "$RESULT_DIR/smith.stdout" 2> "$RESULT_DIR/smith.stderr"`,
    "smith_status=$?",
    "printf '%s\\n' \"$smith_status\" > \"$RESULT_DIR/smith.status\"",
    "set -e",
    "cat \"$RESULT_DIR/smith.stdout\"",
    "cat \"$RESULT_DIR/smith.stderr\" >&2",
    "if [ \"$smith_status\" -ne 0 ]; then exit \"$smith_status\"; fi",
    "cd /workspace",
    "set +e",
    "bash /task/verify.sh > \"$RESULT_DIR/verify.stdout\" 2> \"$RESULT_DIR/verify.stderr\"",
    "verify_status=$?",
    "printf '%s\\n' \"$verify_status\" > \"$RESULT_DIR/verify.status\"",
    "set -e",
    "cat \"$RESULT_DIR/verify.stdout\"",
    "cat \"$RESULT_DIR/verify.stderr\" >&2",
    "exit \"$verify_status\""
  ].join("\n");

  try {
    const result = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--add-host=host.docker.internal:host-gateway",
        "--user",
        `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "-e",
        "HOME=/home/smith",
        "-v",
        `${repoRoot}:/smith`,
        "-v",
        `${workspace}:/workspace`,
        "-v",
        `${home}:/home/smith`,
        "-v",
        `${taskCopy}:/task:ro`,
        image,
        "bash",
        "-lc",
        script
      ],
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 1024 * 1024 * 10 }
    );
    const smithStdout = readBenchmarkArtifact(home, "smith.stdout") || result.stdout;
    const tracePath = smithTracePathFromStdout(home, smithStdout);
    const taskResult: BenchmarkTaskResult = {
      task,
      agent: "smith" as const,
      passed: true,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
      traceDir: join(home, ".smith", "runs"),
      ...(tracePath ? { tracePath } : {}),
      sandboxDir: sandbox,
      usage: usageWithCost(parseSmithUsage(smithStdout), options.cost),
      verifier: readVerifierResult(home)
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command,
      stdout: result.stdout,
      stderr: result.stderr,
      sandboxRetained: Boolean(options.keepSandbox)
    });
    if (!options.keepSandbox) cleanupSandbox(sandbox);
    return taskResult;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    const stdout = failed.stdout ?? "";
    const stderr = failed.stderr ?? String(error);
    const smithStdout = readBenchmarkArtifact(home, "smith.stdout") || stdout;
    const tracePath = smithTracePathFromStdout(home, smithStdout);
    const taskResult: BenchmarkTaskResult = {
      task,
      agent: "smith",
      passed: false,
      durationMs: Date.now() - started,
      stdout,
      stderr,
      traceDir: join(home, ".smith", "runs"),
      ...(tracePath ? { tracePath } : {}),
      sandboxDir: sandbox,
      usage: usageWithCost(parseSmithUsage(smithStdout), options.cost),
      verifier: readVerifierResult(home)
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command,
      stdout,
      stderr,
      sandboxRetained: true
    });
    return taskResult;
  }
}

function prepareSmithArgsForDocker(home: string, args: string[]): string[] {
  if (!usesChatGptCodexAdapter(args) || hasFlag(args, "--codex-auth-path")) return args;
  const hostAuthPath = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  if (!existsSync(hostAuthPath)) return args;
  const sandboxAuthPath = join(home, "codex-auth.json");
  cpSync(hostAuthPath, sandboxAuthPath);
  chmodSync(sandboxAuthPath, 0o600);
  return [...args, "--codex-auth-path", "/home/smith/codex-auth.json"];
}

function usesChatGptCodexAdapter(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--adapter" && args[index + 1] === "chatgpt-codex") return true;
    if (arg === "--adapter=chatgpt-codex") return true;
  }
  return false;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

async function runCodexBenchmarkTask(context: BenchmarkTaskContext): Promise<BenchmarkTaskResult> {
  const { task, taskCopy, workspace, home, sandbox, options } = context;
  const started = Date.now();
  const taskPrompt = readFileSync(join(taskCopy, "Task.md"), "utf8");
  const modelArgs = options.model ? ["--model", options.model] : [];
  const reasoningArgs = options.reasoningEffort
    ? ["-c", `model_reasoning_effort="${options.reasoningEffort}"`]
    : [];
  const prompt = benchmarkPrompt(taskPrompt);
  const command = [
    "codex",
    "exec",
    "--json",
    "--color",
    "never",
    "--ephemeral",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    workspace,
    ...modelArgs,
    ...reasoningArgs,
    "-"
  ].join(" ");

  let codexStdout = "";
  let codexStderr = "";
  let verifyStdout = "";
  let verifyStderr = "";
  let verifier: BenchmarkVerifierResult | undefined;
  let codexCompleted = false;
  try {
    const codex = await spawnFileWithInput(
      "codex",
      [
        "exec",
        "--json",
        "--color",
        "never",
        "--ephemeral",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        workspace,
        ...modelArgs,
        ...reasoningArgs,
        "-"
      ],
      prompt,
      {
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 1024 * 1024 * 50,
        env: process.env
      }
    );
    codexStdout = codex.stdout;
    codexStderr = codex.stderr;
    codexCompleted = true;

    const verify = await execFileAsync("bash", [join(taskCopy, "verify.sh")], {
      cwd: workspace,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 10
    });
    verifyStdout = verify.stdout;
    verifyStderr = verify.stderr;
    verifier = { command: `bash ${join(taskCopy, "verify.sh")}`, exitCode: 0, stdout: verifyStdout, stderr: verifyStderr };
    const taskResult: BenchmarkTaskResult = {
      task,
      agent: "codex" as const,
      passed: true,
      durationMs: Date.now() - started,
      stdout: `${codexStdout}${verifyStdout}`,
      stderr: `${codexStderr}${verifyStderr}`,
      traceDir: codexTraceDir(),
      sandboxDir: sandbox,
      usage: usageWithCost(parseCodexUsage(codexStdout), options.cost),
      verifier
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command,
      stdout: taskResult.stdout,
      stderr: taskResult.stderr,
      sandboxRetained: Boolean(options.keepSandbox)
    });
    if (!options.keepSandbox) cleanupSandbox(sandbox);
    return taskResult;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    if (codexCompleted) {
      verifyStdout = failed.stdout ?? "";
      verifyStderr = failed.stderr ?? String(error);
      verifier = {
        command: `bash ${join(taskCopy, "verify.sh")}`,
        exitCode: typeof failed.code === "number" ? failed.code : undefined,
        stdout: verifyStdout,
        stderr: verifyStderr
      };
    }
    const stdout = `${codexStdout}${codexCompleted ? verifyStdout : failed.stdout ?? ""}`;
    const stderr = `${codexStderr}${codexCompleted ? verifyStderr : failed.stderr ?? String(error)}`;
    const taskResult: BenchmarkTaskResult = {
      task,
      agent: "codex",
      passed: false,
      durationMs: Date.now() - started,
      stdout,
      stderr,
      traceDir: codexTraceDir(),
      sandboxDir: sandbox,
      usage: usageWithCost(parseCodexUsage(codexStdout || failed.stdout || ""), options.cost),
      ...(verifier ? { verifier } : {})
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command,
      stdout,
      stderr,
      sandboxRetained: true
    });
    return taskResult;
  }
}

function benchmarkPrompt(taskPrompt: string): string {
  return [
    "Complete this benchmark task in the current workspace.",
    "Make only the file changes needed for the task. Do not modify files outside the workspace.",
    "Inspect and edit files with shell commands. Do not call chat_out until the requested change is actually implemented and, when practical, checked.",
    "The benchmark verifier is available at /task/verify.sh; run bash /task/verify.sh before chat_out unless blocked.",
    "If files need to change, a response that only calls chat_out is a failed benchmark attempt.",
    "",
    taskPrompt
  ].join("\n");
}

function discoverTasks(path: string): string[] {
  const root = resolve(path);
  if (existsSync(join(root, "Task.md"))) return [root];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, "Task.md")))
    .sort((left, right) => left.localeCompare(right));
}

export type BenchmarkValidationResult = {
  task: string;
  valid: boolean;
  errors: string[];
};

export function validateBenchmarkPath(path: string): BenchmarkValidationResult[] {
  return discoverTasks(path).map((task) => {
    const errors = benchmarkTaskErrors(task);
    return { task, valid: errors.length === 0, errors };
  });
}

export function validateBenchmarkTask(task: string): void {
  const errors = benchmarkTaskErrors(task);
  if (errors.length > 0) throw new Error(`invalid benchmark task ${task}: ${errors.join("; ")}`);
}

function benchmarkTaskErrors(task: string): string[] {
  const errors: string[] = [];
  const taskFile = join(task, "Task.md");
  const workspace = join(task, "workspace");
  const verify = join(task, "verify.sh");
  if (!existsSync(taskFile)) errors.push("missing Task.md");
  if (!existsSync(workspace)) {
    errors.push("missing workspace");
  } else if (!statSync(workspace).isDirectory()) {
    errors.push("workspace is not a directory");
  }
  if (!existsSync(verify)) {
    errors.push("missing verify.sh");
  } else if (!statSync(verify).isFile()) {
    errors.push("verify.sh is not a file");
  }
  return errors;
}

function cleanupSandbox(sandbox: string): void {
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // Docker-created files can be owned by a different uid on some hosts.
  }
}

function writeBenchmarkSessionLog(
  result: BenchmarkTaskResult,
  logDir: string | undefined,
  processOutput: { command: string; stdout: string; stderr: string; sandboxRetained: boolean }
): string | undefined {
  const trace = summarizeTrace(result.tracePath);
  return writeSessionLog(configuredLogDir(logDir), `${result.agent}-${basename(result.task)}`, {
    kind: "smith.benchmark",
    taskId: basename(result.task),
    taskPath: result.task,
    agent: result.agent,
    command: processOutput.command,
    passed: result.passed,
    durationMs: result.durationMs,
    stdout: processOutput.stdout,
    stderr: processOutput.stderr,
    traceDir: result.traceDir,
    tracePath: result.tracePath,
    sandboxPath: result.sandboxDir,
    sandboxRetained: processOutput.sandboxRetained,
    usage: result.usage,
    verifier: result.verifier,
    modelOutputs: trace.modelOutputs,
    terminalOutputs: trace.terminalOutputs,
    parsedEvents: trace.parsedEvents,
    chatOut: trace.chatOut
  });
}

function readBenchmarkArtifact(home: string, name: string): string {
  const path = join(home, "benchmark-results", name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function readVerifierResult(home: string): BenchmarkVerifierResult | undefined {
  const status = numericString(readBenchmarkArtifact(home, "verify.status").trim());
  const stdout = readBenchmarkArtifact(home, "verify.stdout");
  const stderr = readBenchmarkArtifact(home, "verify.stderr");
  if (status === undefined && !stdout && !stderr) return undefined;
  return {
    command: "bash /task/verify.sh",
    ...(status !== undefined ? { exitCode: status } : {}),
    stdout,
    stderr
  };
}

function smithTracePathFromStdout(home: string, stdout: string): string | undefined {
  const parsed = (parseJsonObject(stdout) ?? parseFirstJsonObject(stdout)) as { tracePath?: unknown } | undefined;
  const tracePath = typeof parsed?.tracePath === "string" ? tracePathFromContainerPath(home, parsed.tracePath) : undefined;
  return tracePath && existsSync(tracePath) ? tracePath : latestSmithTracePath(home);
}

function latestSmithTracePath(home: string): string | undefined {
  const dir = join(home, ".smith", "runs");
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".trace"))
    .map((file) => join(dir, file))
    .sort();
  return files.at(-1);
}

function codexTraceDir(): string {
  return process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
}

function parseSmithUsage(stdout: string): BenchmarkUsage | undefined {
  const parsed = (parseJsonObject(stdout) ?? parseFirstJsonObject(stdout)) as { usage?: Partial<BenchmarkUsage> } | undefined;
  if (!parsed?.usage) return undefined;
  return normalizeUsage(parsed.usage);
}

function parseCodexUsage(stdout: string): BenchmarkUsage | undefined {
  let latest: unknown;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseJsonObject(line) as
      | {
          type?: string;
          usage?: unknown;
          msg?: { type?: string; usage?: unknown };
          payload?: { type?: string; info?: { total_token_usage?: unknown } };
        }
      | undefined;
    if (event?.payload?.type === "token_count" && event.payload.info?.total_token_usage) {
      latest = event.payload.info.total_token_usage;
    } else if (event?.msg?.type === "token_count" && event.msg.usage) {
      latest = event.msg.usage;
    } else if (event?.type === "turn.completed" && event.usage) {
      latest = event.usage;
    }
  }
  return normalizeUsage(latest);
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return parseJsonObject(text.slice(start, index + 1));
    }
  }
  return undefined;
}

function normalizeUsage(value: unknown): BenchmarkUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const inputTokens = numeric(record.inputTokens ?? record.input_tokens);
  const cachedInputTokens = numeric(record.cachedInputTokens ?? record.cached_input_tokens) ?? 0;
  const outputTokens = numeric(record.outputTokens ?? record.output_tokens);
  const reasoningOutputTokens = numeric(record.reasoningOutputTokens ?? record.reasoning_output_tokens) ?? 0;
  const totalTokens = numeric(record.totalTokens ?? record.total_tokens);
  const costUsd = numeric(record.costUsd ?? record.cost_usd);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return {
    inputTokens: inputTokens ?? 0,
    cachedInputTokens,
    outputTokens: outputTokens ?? 0,
    reasoningOutputTokens,
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
    ...(costUsd !== undefined ? { costUsd } : {})
  };
}

function usageWithCost(usage: BenchmarkUsage | undefined, rates: BenchmarkCostRates | undefined): BenchmarkUsage | undefined {
  if (!usage) return undefined;
  const costUsd = usage.costUsd ?? calculateCost(usage, rates);
  return { ...usage, ...(costUsd !== undefined ? { costUsd } : {}) };
}

function calculateCost(usage: BenchmarkUsage, rates: BenchmarkCostRates | undefined): number | undefined {
  if (!rates) return undefined;
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const uncachedInputCost = costForTokens(uncachedInputTokens, rates.inputCostPerMillionTokens);
  const cachedInputCost = costForTokens(usage.cachedInputTokens, rates.cachedInputCostPerMillionTokens ?? rates.inputCostPerMillionTokens);
  const outputCost = costForTokens(usage.outputTokens, rates.outputCostPerMillionTokens);
  if (uncachedInputCost === undefined && cachedInputCost === undefined && outputCost === undefined) return undefined;
  return (uncachedInputCost ?? 0) + (cachedInputCost ?? 0) + (outputCost ?? 0);
}

function costForTokens(tokens: number, rate: number | undefined): number | undefined {
  return rate === undefined ? undefined : (tokens / 1_000_000) * rate;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numericString(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../../.."), process.cwd()];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json")) && existsSync(join(candidate, "bin/smith.js"))) {
      return candidate;
    }
  }
  throw new Error("could not locate Smith repository root");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function spawnFileWithInput(
  command: string,
  args: string[],
  input: string,
  options: {
    timeout: number;
    maxBuffer: number;
    env?: NodeJS.ProcessEnv;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(Object.assign(new Error(`${command} timed out after ${options.timeout}ms`), collectOutput()));
    }, options.timeout);

    const collectOutput = () => ({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    });
    const collect = (chunks: Buffer[], length: number, chunk: Buffer): number => {
      const nextLength = length + chunk.length;
      if (nextLength > options.maxBuffer && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        reject(Object.assign(new Error(`${command} exceeded maxBuffer`), collectOutput()));
      } else {
        chunks.push(chunk);
      }
      return nextLength;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLength = collect(stdout, stdoutLength, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrLength = collect(stderr, stderrLength, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(error, collectOutput()));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = collectOutput();
      if (code === 0) resolve(output);
      else reject(Object.assign(new Error(`${command} exited with code ${code}`), output));
    });
    child.stdin.end(input);
  });
}
