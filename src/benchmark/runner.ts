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

type BenchmarkTaskKind = "local" | "swe-bench-pro";

type SweBenchProTaskMetadata = {
  format: "swe-bench-pro-v1";
  repo: string;
  instanceId: string;
  baseCommit: string;
  repoLanguage: string;
  dockerImage: string;
  setupCommand?: string;
  selectedTestFilesToRun: string[];
  failToPass: string[];
  passToPass: string[];
};

export type BenchmarkCostRates = {
  inputCostPerMillionTokens?: number;
  cachedInputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

export const BENCHMARK_TASK_INSTRUCTIONS = [
  "Complete this benchmark task in the current workspace.",
  "Make only the file changes needed for the task. Do not modify files outside the workspace.",
  "Inspect and edit files with shell commands. Do not call chat_out until the requested change is actually implemented and, when practical, checked.",
  "The benchmark verifier is available at /task/verify.sh; run bash /task/verify.sh before chat_out unless blocked.",
  "After a focused edit, run the verifier directly; avoid optional status, diff, or .git self-checks unless diagnosing a concrete failure.",
  "Do not read /task/verify.sh before the first verifier run; inspect it only after a verifier failure or when you are blocked.",
  "If files need to change, a response that only calls chat_out is a failed benchmark attempt."
];

const SWE_BENCH_PRO_TASK_INSTRUCTIONS = [
  "This task comes from SWE-bench Pro. The repository checkout is already available in the current workspace.",
  "Project-specific verification runs after your final answer in the original SWE-bench Pro Docker image.",
  "If this editing container lacks project-specific dependencies, use shell inspection and focused edits instead of installing broad dependency sets."
];

export async function runBenchmarkPath(path: string, options: BenchmarkRunOptions = {}): Promise<BenchmarkTaskResult[]> {
  const taskPaths = discoverTasks(resolveBenchmarkTarget(path));
  const results: BenchmarkTaskResult[] = [];
  for (const taskPath of taskPaths) {
    results.push(await runBenchmarkTask(taskPath, options));
  }
  return results;
}

export async function runBenchmarkTask(taskPath: string, options: BenchmarkRunOptions = {}): Promise<BenchmarkTaskResult> {
  const task = resolveBenchmarkTarget(taskPath);
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
  const taskKind = benchmarkTaskKind(taskCopy);
  if (taskKind === "swe-bench-pro") {
    return runSweBenchProBenchmarkTask({ task, taskCopy, workspace, home, sandbox, options, repoRoot });
  }

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

async function runSweBenchProBenchmarkTask(context: BenchmarkTaskContext & { repoRoot: string }): Promise<BenchmarkTaskResult> {
  const { task, taskCopy, workspace, home, sandbox, options, repoRoot } = context;
  const started = Date.now();
  const metadata = readSweBenchProTaskMetadata(taskCopy);
  const agent = options.agent ?? "smith";
  let agentStdout = "";
  let agentStderr = "";
  let verifier: BenchmarkVerifierResult | undefined;

  try {
    await prepareSweBenchProWorkspace(metadata, workspace, options.timeoutMs ?? 120_000);
    if (agent === "codex") {
      const codex = await runCodexForSweBenchProTask({ taskCopy, workspace, options, metadata });
      agentStdout = codex.stdout;
      agentStderr = codex.stderr;
    } else {
      const smith = await runSmithForSweBenchProTask({ taskCopy, workspace, home, options, repoRoot, metadata });
      agentStdout = smith.stdout;
      agentStderr = smith.stderr;
    }
    verifier = await runSweBenchProVerifier({ metadata, taskCopy, workspace, sandbox, timeoutMs: options.timeoutMs ?? 120_000 });
    const taskResult: BenchmarkTaskResult = {
      task,
      agent,
      passed: true,
      durationMs: Date.now() - started,
      stdout: `${agentStdout}${verifier.stdout}`,
      stderr: `${agentStderr}${verifier.stderr}`,
      traceDir: agent === "smith" ? join(home, ".smith", "runs") : codexTraceDir(),
      ...(agent === "smith" ? optionalTracePath(home, agentStdout) : {}),
      sandboxDir: sandbox,
      usage: usageWithCost(agent === "smith" ? parseSmithUsage(agentStdout) : parseCodexUsage(agentStdout), options.cost),
      verifier
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command: sweBenchProCommandForLog(agent, metadata),
      stdout: taskResult.stdout,
      stderr: taskResult.stderr,
      sandboxRetained: Boolean(options.keepSandbox)
    });
    if (!options.keepSandbox) cleanupSandbox(sandbox);
    return taskResult;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number; verifier?: BenchmarkVerifierResult };
    if (failed.verifier) verifier = failed.verifier;
    const stdout = `${agentStdout}${failed.stdout ?? ""}`;
    const stderr = `${agentStderr}${failed.stderr ?? String(error)}`;
    const taskResult: BenchmarkTaskResult = {
      task,
      agent,
      passed: false,
      durationMs: Date.now() - started,
      stdout,
      stderr,
      traceDir: agent === "smith" ? join(home, ".smith", "runs") : codexTraceDir(),
      ...(agent === "smith" ? optionalTracePath(home, agentStdout || stdout) : {}),
      sandboxDir: sandbox,
      usage: usageWithCost(agent === "smith" ? parseSmithUsage(agentStdout || stdout) : parseCodexUsage(agentStdout || stdout), options.cost),
      ...(verifier ? { verifier } : {})
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command: sweBenchProCommandForLog(agent, metadata),
      stdout,
      stderr,
      sandboxRetained: true
    });
    return taskResult;
  }
}

async function runSmithForSweBenchProTask(context: {
  taskCopy: string;
  workspace: string;
  home: string;
  options: BenchmarkRunOptions;
  repoRoot: string;
  metadata: SweBenchProTaskMetadata;
}): Promise<{ stdout: string; stderr: string }> {
  const { taskCopy, workspace, home, options, repoRoot, metadata } = context;
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
    `TASK=$(printf '%s\\n\\n' ${benchmarkInstructionsForTask(metadata).map(shellQuote).join(" ")}; cat /task/Task.md)`,
    "set +e",
    `${command} > "$RESULT_DIR/smith.stdout" 2> "$RESULT_DIR/smith.stderr"`,
    "smith_status=$?",
    "printf '%s\\n' \"$smith_status\" > \"$RESULT_DIR/smith.status\"",
    "set -e",
    "cat \"$RESULT_DIR/smith.stdout\"",
    "cat \"$RESULT_DIR/smith.stderr\" >&2",
    "exit \"$smith_status\""
  ].join("\n");
  return execFileAsync(
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
    { timeout: options.timeoutMs ?? 120_000, maxBuffer: 1024 * 1024 * 50 }
  );
}

async function runCodexForSweBenchProTask(context: {
  taskCopy: string;
  workspace: string;
  options: BenchmarkRunOptions;
  metadata: SweBenchProTaskMetadata;
}): Promise<{ stdout: string; stderr: string }> {
  const { taskCopy, workspace, options, metadata } = context;
  const modelArgs = options.model ? ["--model", options.model] : [];
  const reasoningArgs = options.reasoningEffort
    ? ["-c", `model_reasoning_effort="${options.reasoningEffort}"`]
    : [];
  const prompt = benchmarkPrompt(readFileSync(join(taskCopy, "Task.md"), "utf8"), benchmarkInstructionsForTask(metadata));
  return spawnFileWithInput(
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
}

async function prepareSweBenchProWorkspace(
  metadata: SweBenchProTaskMetadata,
  workspace: string,
  timeoutMs: number
): Promise<void> {
  mkdirSync(workspace, { recursive: true });
  const created = await execFileAsync("docker", ["create", metadata.dockerImage], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024
  });
  const containerId = created.stdout.trim();
  try {
    await execFileAsync("docker", ["cp", `${containerId}:/app/.`, workspace], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 10
    });
  } finally {
    await execFileAsync("docker", ["rm", "-f", containerId], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    }).catch(() => undefined);
  }
  if (process.getuid && process.getgid) {
    await execFileAsync("chown", ["-R", `${process.getuid()}:${process.getgid()}`, workspace], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    });
  }
}

async function runSweBenchProVerifier(context: {
  metadata: SweBenchProTaskMetadata;
  taskCopy: string;
  workspace: string;
  sandbox: string;
  timeoutMs: number;
}): Promise<BenchmarkVerifierResult> {
  const { metadata, taskCopy, workspace, sandbox, timeoutMs } = context;
  const resultsDir = join(sandbox, "benchmark-results");
  mkdirSync(resultsDir, { recursive: true });
  const script = [
    "set -euo pipefail",
    "mkdir -p /benchmark-results",
    "cd /app",
    metadata.setupCommand?.trim() ? metadata.setupCommand.trim() : ":",
    "set +e",
    `bash /task/run_script.sh ${metadata.selectedTestFilesToRun.map(shellQuote).join(" ")} > /benchmark-results/stdout.log 2> /benchmark-results/stderr.log`,
    "test_status=$?",
    "set -e",
    "cat /benchmark-results/stdout.log",
    "cat /benchmark-results/stderr.log >&2",
    "python /task/parser.py /benchmark-results/stdout.log /benchmark-results/stderr.log /benchmark-results/output.json",
    "python - <<'PY'",
    "import json, sys",
    "with open('/task/task.json') as f:",
    "    task = json.load(f)",
    "with open('/benchmark-results/output.json') as f:",
    "    output = json.load(f)",
    "statuses = {item.get('name'): item.get('status') for item in output.get('tests', [])}",
    "required = list(task.get('failToPass', [])) + list(task.get('passToPass', []))",
    "missing = [name for name in required if name not in statuses]",
    "failed = [name for name in required if statuses.get(name) != 'PASSED']",
    "if missing or failed:",
    "    print(json.dumps({'missing': missing, 'failed': failed[:50]}, indent=2), file=sys.stderr)",
    "    sys.exit(1)",
    "print(json.dumps({'passed': len(required)}))",
    "PY",
    "exit \"$test_status\""
  ].join("\n");
  const command = `docker run --rm -v ${workspace}:/app -v ${taskCopy}:/task:ro ${metadata.dockerImage} -lc <verifier>`;
  try {
    const result = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${workspace}:/app`,
        "-v",
        `${taskCopy}:/task:ro`,
        "-v",
        `${resultsDir}:/benchmark-results`,
        metadata.dockerImage,
        "-lc",
        script
      ],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 50 }
    );
    return { command, exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    const verifier = {
      command,
      ...(typeof failed.code === "number" ? { exitCode: failed.code } : {}),
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? String(error)
    };
    throw Object.assign(new Error("SWE-bench Pro verifier failed"), {
      stdout: verifier.stdout,
      stderr: verifier.stderr,
      verifier
    });
  }
}

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
    `TASK=$(printf '%s\\n\\n' ${BENCHMARK_TASK_INSTRUCTIONS.map(shellQuote).join(" ")}; cat /task/Task.md)`,
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

function benchmarkPrompt(taskPrompt: string, instructions = BENCHMARK_TASK_INSTRUCTIONS): string {
  return [
    ...instructions,
    "",
    taskPrompt
  ].join("\n");
}

function discoverTasks(path: string): string[] {
  const root = resolve(path);
  if (existsSync(join(root, "Task.md"))) return [root];
  if (existsSync(join(root, "dataset.json")) && existsSync(join(root, "tasks"))) {
    return discoverTasks(join(root, "tasks"));
  }
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, "Task.md")))
    .sort((left, right) => left.localeCompare(right));
}

export function resolveBenchmarkTarget(target: string): string {
  const direct = resolve(target);
  if (existsSync(direct)) return direct;
  if (target.startsWith(".") || target.startsWith("/") || target.includes("..")) return direct;

  const [dataset, ...taskParts] = target.split(/[\\/]/).filter(Boolean);
  if (!dataset) return direct;
  const datasetRoot = join(findRepoRoot(), "benchmark-datasets", dataset);
  if (taskParts.length === 0) return existsSync(datasetRoot) ? datasetRoot : direct;
  const task = join(datasetRoot, "tasks", ...taskParts);
  return existsSync(task) ? task : direct;
}

export type BenchmarkValidationResult = {
  task: string;
  valid: boolean;
  errors: string[];
};

export function validateBenchmarkPath(path: string): BenchmarkValidationResult[] {
  return discoverTasks(resolveBenchmarkTarget(path)).map((task) => {
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
  if (!existsSync(taskFile)) errors.push("missing Task.md");
  if (benchmarkTaskKind(task) === "swe-bench-pro") {
    return [...errors, ...sweBenchProTaskErrors(task)];
  }

  const workspace = join(task, "workspace");
  const verify = join(task, "verify.sh");
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

function benchmarkTaskKind(task: string): BenchmarkTaskKind {
  const metadataPath = join(task, "task.json");
  if (!existsSync(metadataPath)) return "local";
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as { format?: unknown };
    return metadata.format === "swe-bench-pro-v1" ? "swe-bench-pro" : "local";
  } catch {
    return "local";
  }
}

function sweBenchProTaskErrors(task: string): string[] {
  const errors: string[] = [];
  const metadataPath = join(task, "task.json");
  const runScript = join(task, "run_script.sh");
  const parser = join(task, "parser.py");
  if (!existsSync(metadataPath)) {
    errors.push("missing task.json");
  } else {
    try {
      readSweBenchProTaskMetadata(task);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!existsSync(runScript)) errors.push("missing run_script.sh");
  else if (!statSync(runScript).isFile()) errors.push("run_script.sh is not a file");
  if (!existsSync(parser)) errors.push("missing parser.py");
  else if (!statSync(parser).isFile()) errors.push("parser.py is not a file");
  return errors;
}

function readSweBenchProTaskMetadata(task: string): SweBenchProTaskMetadata {
  const metadata = JSON.parse(readFileSync(join(task, "task.json"), "utf8")) as Partial<SweBenchProTaskMetadata>;
  const errors: string[] = [];
  if (metadata.format !== "swe-bench-pro-v1") errors.push("task.json format must be swe-bench-pro-v1");
  for (const key of ["repo", "instanceId", "baseCommit", "repoLanguage", "dockerImage"] as const) {
    if (typeof metadata[key] !== "string" || !metadata[key]) errors.push(`task.json missing ${key}`);
  }
  for (const key of ["selectedTestFilesToRun", "failToPass", "passToPass"] as const) {
    if (!Array.isArray(metadata[key]) || !metadata[key]?.every((value) => typeof value === "string")) {
      errors.push(`task.json ${key} must be a string array`);
    }
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  return metadata as SweBenchProTaskMetadata;
}

function benchmarkInstructionsForTask(metadata: SweBenchProTaskMetadata): string[] {
  return [
    ...BENCHMARK_TASK_INSTRUCTIONS.filter((instruction) => !instruction.includes("/task/verify.sh") && !instruction.includes("run the verifier directly")),
    ...SWE_BENCH_PRO_TASK_INSTRUCTIONS,
    `SWE-bench Pro instance: ${metadata.instanceId}`,
    `Repository: ${metadata.repo} at base commit ${metadata.baseCommit}.`
  ];
}

function optionalTracePath(home: string, stdout: string): { tracePath?: string } {
  const tracePath = smithTracePathFromStdout(home, stdout);
  return tracePath ? { tracePath } : {};
}

function sweBenchProCommandForLog(agent: BenchmarkAgent, metadata: SweBenchProTaskMetadata): string {
  return `${agent} swe-bench-pro ${metadata.instanceId} (${metadata.dockerImage})`;
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
