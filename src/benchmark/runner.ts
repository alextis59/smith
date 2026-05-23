import { execFile, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
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
  concurrency?: number;
  cost?: BenchmarkCostRates;
  logDir?: string;
};

type BenchmarkTaskKind = "local" | "swe-bench-pro";

export type SweBenchProTaskMetadata = {
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

export const DEFAULT_SMITH_BENCHMARK_IMAGE = "node:22-bookworm";

export type BenchmarkCostRates = {
  inputCostPerMillionTokens?: number;
  cachedInputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

export const BENCHMARK_TASK_INSTRUCTIONS = [
  "Complete this benchmark task in the current workspace.",
  "Make only the file changes needed for the task. Do not modify files outside the workspace.",
  "When the task names implementation paths, functions, methods, or interfaces, treat those as primary source-code targets; do not satisfy the task with only documentation, localization, fixture, test, build, or generated-file changes unless those are explicitly requested.",
  "Inspect and edit files with the run tool. Do not call finish until the requested change is actually implemented and, when practical, checked.",
  "After an edit command, read its terminal result. If the command failed or might not have changed files, recover immediately and confirm the intended files changed with a targeted file read or path-specific diff before continuing.",
  "The benchmark verifier is available at /task/verify.sh; run bash /task/verify.sh before finish unless blocked.",
  "After a focused edit, run the verifier directly; avoid optional status, diff, or .git self-checks unless diagnosing a concrete failure.",
  "Do not read /task/verify.sh before the first verifier run; inspect it only after a verifier failure or when you are blocked.",
  "If files need to change, a response that only calls finish is a failed benchmark attempt."
];

export const SWE_BENCH_PRO_TASK_INSTRUCTIONS: string[] = [];

export const BENCHMARK_PYTHON_SHIM_SCRIPT = [
  "SHIM_DIR=\"$RESULT_DIR/bin\"",
  "mkdir -p \"$SHIM_DIR\"",
  "if ! command -v python >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then",
  "  ln -sf \"$(command -v python3)\" \"$SHIM_DIR/python\"",
  "fi",
  "if ! command -v rg >/dev/null 2>&1; then",
  "  cat > \"$SHIM_DIR/rg\" <<'SMITH_RG_SHIM'",
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "mode=search",
  "grep_args=(-E -H)",
  "include_globs=()",
  "exclude_globs=()",
  "paths=()",
  "pattern=\"\"",
  "matches_globs() {",
  "  local file=\"$1\" glob",
  "  if [ \"${#include_globs[@]}\" -gt 0 ]; then",
  "    local included=1",
  "    for glob in \"${include_globs[@]}\"; do",
  "      [[ \"$file\" == $glob ]] && included=0",
  "      [[ \"$(basename \"$file\")\" == $glob ]] && included=0",
  "    done",
  "    [ \"$included\" -eq 0 ] || return 1",
  "  fi",
  "  for glob in \"${exclude_globs[@]}\"; do",
  "    [[ \"$file\" == $glob ]] && return 1",
  "    [[ \"$(basename \"$file\")\" == $glob ]] && return 1",
  "  done",
  "  return 0",
  "}",
  "while [ \"$#\" -gt 0 ]; do",
  "  case \"$1\" in",
  "    --files) mode=files; shift ;;",
  "    -n|--line-number) grep_args+=(\"-n\"); shift ;;",
  "    -i|--ignore-case) grep_args+=(\"-i\"); shift ;;",
  "    -l|--files-with-matches) grep_args+=(\"-l\"); shift ;;",
  "    -g|--glob)",
  "      glob=\"${2:-}\"",
  "      if [[ \"$glob\" == !* ]]; then exclude_globs+=(\"${glob:1}\"); else include_globs+=(\"$glob\"); fi",
  "      shift 2 ;;",
  "    --glob=*)",
  "      glob=\"${1#--glob=}\"",
  "      if [[ \"$glob\" == !* ]]; then exclude_globs+=(\"${glob:1}\"); else include_globs+=(\"$glob\"); fi",
  "      shift ;;",
  "    --no-heading|--hidden|--smart-case|-S|-u|-uu) shift ;;",
  "    --color) shift 2 ;;",
  "    --color=*) shift ;;",
  "    --) shift; break ;;",
  "    -*) shift ;;",
  "    *) break ;;",
  "  esac",
  "done",
  "if [ \"$mode\" = \"search\" ]; then",
  "  if [ \"$#\" -eq 0 ]; then exit 2; fi",
  "  pattern=\"$1\"",
  "  shift",
  "fi",
  "if [ \"$#\" -eq 0 ]; then set -- .; fi",
  "paths=(\"$@\")",
  "status=1",
  "while IFS= read -r -d '' file; do",
  "  matches_globs \"$file\" || continue",
  "  if [ \"$mode\" = \"files\" ]; then",
  "    printf '%s\\n' \"$file\"",
  "    status=0",
  "  else",
  "    if grep \"${grep_args[@]}\" -- \"$pattern\" \"$file\"; then status=0; fi",
  "  fi",
  "done < <(find \"${paths[@]}\" -type f -print0 2>/dev/null)",
  "exit \"$status\"",
  "SMITH_RG_SHIM",
  "  chmod +x \"$SHIM_DIR/rg\"",
  "fi",
  "export PATH=\"$SHIM_DIR:$PATH\""
];

export async function runBenchmarkPath(path: string, options: BenchmarkRunOptions = {}): Promise<BenchmarkTaskResult[]> {
  const taskPaths = discoverTasks(resolveBenchmarkTarget(path));
  return runTasksWithConcurrency(taskPaths, options.concurrency ?? 1, (taskPath) => runBenchmarkTask(taskPath, options));
}

export async function runTasksWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`benchmark concurrency must be a positive integer, got ${concurrency}`);
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
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
  let agentImage: string | undefined;
  let verifier: BenchmarkVerifierResult | undefined;
  let hiddenGitDir: string | undefined;

  try {
    await prepareSweBenchProWorkspace(metadata, workspace, options.timeoutMs ?? 120_000);
    hiddenGitDir = hideSweBenchProGitDir(workspace, sandbox);
    if (agent === "codex") {
      const codex = await runCodexForSweBenchProTask({ taskCopy, workspace, options, metadata });
      agentStdout = codex.stdout;
      agentStderr = codex.stderr;
    } else {
      const smith = await runSmithForSweBenchProTask({ taskCopy, workspace, home, options, repoRoot, metadata });
      agentStdout = smith.stdout;
      agentStderr = smith.stderr;
      agentImage = smith.image;
    }
    restoreSweBenchProGitDir(workspace, hiddenGitDir);
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
      usage: usageWithCost(agent === "smith" ? smithUsageFromOutputOrTrace(home, agentStdout) : parseCodexUsage(agentStdout), options.cost),
      verifier
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command: sweBenchProCommandForLog(agent, metadata, agentImage),
      stdout: taskResult.stdout,
      stderr: taskResult.stderr,
      sandboxRetained: Boolean(options.keepSandbox)
    });
    if (!options.keepSandbox) cleanupSandbox(sandbox);
    return taskResult;
  } catch (error) {
    restoreSweBenchProGitDir(workspace, hiddenGitDir);
    const failed = error as { stdout?: string; stderr?: string; code?: number; verifier?: BenchmarkVerifierResult };
    if (failed.verifier) verifier = failed.verifier;
    const stdout = `${agentStdout}${failed.stdout ?? ""}`;
    const stderr = `${agentStderr}${errorStderr(failed, error)}`;
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
      usage: usageWithCost(
        agent === "smith" ? smithUsageFromOutputOrTrace(home, agentStdout || stdout) : parseCodexUsage(agentStdout || stdout),
        options.cost
      ),
      ...(verifier ? { verifier } : {})
    };
    taskResult.logPath = writeBenchmarkSessionLog(taskResult, options.logDir, {
      command: sweBenchProCommandForLog(agent, metadata, agentImage),
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
}): Promise<{ stdout: string; stderr: string; image: string }> {
  const { taskCopy, workspace, home, options, repoRoot, metadata } = context;
  const image = await selectSweBenchProSmithImage({ metadata, options, repoRoot, timeoutMs: options.timeoutMs ?? 120_000 });
  const profileArgs = options.profile ? ["--profile", options.profile] : [];
  const smithArgs = prepareSmithArgsForDocker(home, [...profileArgs, ...(options.smithArgs ?? [])]);
  const jsonArgs = ["--quiet", "--json"];
  const command = `node /smith/bin/smith.js --cwd /workspace ${[...smithArgs, ...jsonArgs].map(shellQuote).join(" ")} "$TASK"`;
  const containerName = dockerContainerName(dirname(home), "smith");
  const script = buildSweBenchProSmithScript(metadata, command);
  try {
    const result = await runDockerBenchmarkContainer(
      containerName,
      buildSmithBenchmarkDockerArgs({ containerName, image, repoRoot, workspace, home, taskCopy, script }),
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 1024 * 1024 * 50 }
    );
    return { ...result, image };
  } finally {
    await cleanupDockerContainer(containerName);
  }
}

export function buildSweBenchProSmithScript(metadata: SweBenchProTaskMetadata, command: string): string {
  return [
    "set -euo pipefail",
    "export PATH=/usr/local/go/bin:/go/bin:$PATH",
    "mkdir -p /home/smith",
    "RESULT_DIR=/home/smith/benchmark-results",
    "mkdir -p \"$RESULT_DIR\"",
    ...BENCHMARK_PYTHON_SHIM_SCRIPT,
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
}

export function buildSmithBenchmarkDockerArgs(context: {
  containerName: string;
  image: string;
  repoRoot: string;
  workspace: string;
  home: string;
  taskCopy: string;
  script: string;
}): string[] {
  const { containerName, image, repoRoot, workspace, home, taskCopy, script } = context;
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--add-host=host.docker.internal:host-gateway",
    "--entrypoint",
    "bash",
    ...dockerUserArgs(),
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
    "-lc",
    script
  ];
}

async function selectSweBenchProSmithImage(context: {
  metadata: SweBenchProTaskMetadata;
  options: BenchmarkRunOptions;
  repoRoot: string;
  timeoutMs: number;
}): Promise<string> {
  const { metadata, options, repoRoot, timeoutMs } = context;
  if (options.image) return options.image;
  if (await canRunSmithInImage(metadata.dockerImage, repoRoot, timeoutMs)) return metadata.dockerImage;
  return DEFAULT_SMITH_BENCHMARK_IMAGE;
}

async function canRunSmithInImage(image: string, repoRoot: string, timeoutMs: number): Promise<boolean> {
  try {
    await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "bash",
        ...dockerUserArgs(),
        "-e",
        "HOME=/tmp",
        "-v",
        `${repoRoot}:/smith:ro`,
        image,
        "-lc",
        [
          "export PATH=/usr/local/go/bin:/go/bin:$PATH",
          "command -v node >/dev/null 2>&1",
          "node -e 'const major = Number(process.versions.node.split(\".\")[0]); process.exit(major >= 20 ? 0 : 1)'",
          "node /smith/bin/smith.js --version >/dev/null 2>&1"
        ].join(" && ")
      ],
      { timeout: Math.min(timeoutMs, 30_000), maxBuffer: 1024 * 1024 }
    );
    return true;
  } catch {
    return false;
  }
}

function dockerUserArgs(): string[] {
  return ["--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`];
}

export function hideSweBenchProGitDir(workspace: string, sandbox: string): string | undefined {
  const gitDir = join(workspace, ".git");
  if (!existsSync(gitDir)) return undefined;
  const hiddenGitDir = join(sandbox, "workspace.git");
  rmSync(hiddenGitDir, { recursive: true, force: true });
  renameSync(gitDir, hiddenGitDir);
  return hiddenGitDir;
}

export function restoreSweBenchProGitDir(workspace: string, hiddenGitDir?: string): void {
  if (!hiddenGitDir || !existsSync(hiddenGitDir)) return;
  const gitDir = join(workspace, ".git");
  rmSync(gitDir, { recursive: true, force: true });
  renameSync(hiddenGitDir, gitDir);
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
  const script = buildSweBenchProVerifierScript(metadata);
  const command = `docker run --rm --entrypoint bash -v ${workspace}:/app -v ${taskCopy}:/task:ro -v ${resultsDir}:/benchmark-results ${metadata.dockerImage} -lc <verifier>`;
  const containerName = dockerContainerName(sandbox, "verify");
  try {
    const result = await runDockerBenchmarkContainer(
      containerName,
      buildSweBenchProVerifierDockerArgs({ containerName, image: metadata.dockerImage, workspace, taskCopy, resultsDir, script }),
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 50 }
    );
    return { command, exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    const verifier = {
      command,
      ...(typeof failed.code === "number" ? { exitCode: failed.code } : {}),
      stdout: failed.stdout ?? "",
      stderr: errorStderr(failed, error)
    };
    throw Object.assign(new Error("SWE-bench Pro verifier failed"), {
      stdout: verifier.stdout,
      stderr: verifier.stderr,
      verifier
    });
  } finally {
    await cleanupDockerContainer(containerName);
  }
}

export function buildSweBenchProVerifierDockerArgs(context: {
  containerName: string;
  image: string;
  workspace: string;
  taskCopy: string;
  resultsDir: string;
  script: string;
}): string[] {
  const { containerName, image, workspace, taskCopy, resultsDir, script } = context;
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--entrypoint",
    "bash",
    "-v",
    `${workspace}:/app`,
    "-v",
    `${taskCopy}:/task:ro`,
    "-v",
    `${resultsDir}:/benchmark-results`,
    image,
    "-lc",
    script
  ];
}

export function buildSweBenchProVerifierScript(metadata: SweBenchProTaskMetadata): string {
  const script = [
    "set -euo pipefail",
    "export PATH=/usr/local/go/bin:$PATH",
    "git config --global --add safe.directory /app || true",
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
  return script;
}

async function runSmithBenchmarkTask(context: BenchmarkTaskContext & { repoRoot: string }): Promise<BenchmarkTaskResult> {
  const { task, taskCopy, workspace, home, sandbox, options, repoRoot } = context;
  const started = Date.now();
  const image = options.image ?? "node:22-bookworm";
  const profileArgs = options.profile ? ["--profile", options.profile] : [];
  const smithArgs = prepareSmithArgsForDocker(home, [...profileArgs, ...(options.smithArgs ?? [])]);
  const jsonArgs = ["--quiet", "--json"];
  const command = `node /smith/bin/smith.js --cwd /workspace ${[...smithArgs, ...jsonArgs].map(shellQuote).join(" ")} "$TASK"`;
  const containerName = dockerContainerName(sandbox, "smith");
  const script = [
    "set -euo pipefail",
    "mkdir -p /home/smith",
    "RESULT_DIR=/home/smith/benchmark-results",
    "mkdir -p \"$RESULT_DIR\"",
    ...BENCHMARK_PYTHON_SHIM_SCRIPT,
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
    const result = await runDockerBenchmarkContainer(
      containerName,
      [
        "run",
        "--rm",
        "--name",
        containerName,
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
      usage: usageWithCost(smithUsageFromOutputOrTrace(home, smithStdout), options.cost),
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
    const stderr = errorStderr(failed, error);
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
      usage: usageWithCost(smithUsageFromOutputOrTrace(home, smithStdout), options.cost),
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
  const hostInstallationPath = join(dirname(hostAuthPath), "installation_id");
  if (existsSync(hostInstallationPath)) {
    cpSync(hostInstallationPath, join(home, "installation_id"));
  }
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
      verifyStderr = errorStderr(failed, error);
      verifier = {
        command: `bash ${join(taskCopy, "verify.sh")}`,
        exitCode: typeof failed.code === "number" ? failed.code : undefined,
        stdout: verifyStdout,
        stderr: verifyStderr
      };
    }
    const stdout = `${codexStdout}${codexCompleted ? verifyStdout : failed.stdout ?? ""}`;
    const stderr = `${codexStderr}${codexCompleted ? verifyStderr : errorStderr(failed, error)}`;
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
  if (instructions.length === 0) return taskPrompt;
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
  return SWE_BENCH_PRO_TASK_INSTRUCTIONS;
}

function optionalTracePath(home: string, stdout: string): { tracePath?: string } {
  const tracePath = smithTracePathFromStdout(home, stdout);
  return tracePath ? { tracePath } : {};
}

function smithUsageFromOutputOrTrace(home: string, stdout: string): BenchmarkUsage | undefined {
  return parseSmithUsage(stdout) ?? parseSmithTraceUsage(smithTracePathFromStdout(home, stdout));
}

function sweBenchProCommandForLog(agent: BenchmarkAgent, metadata: SweBenchProTaskMetadata, agentImage?: string): string {
  const imageText = agentImage && agentImage !== metadata.dockerImage ? `, agent image ${agentImage}` : "";
  return `${agent} swe-bench-pro ${metadata.instanceId} (task image ${metadata.dockerImage}${imageText})`;
}

function cleanupSandbox(sandbox: string): void {
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // Docker-created files can be owned by a different uid on some hosts.
  }
}

async function runDockerBenchmarkContainer(
  containerName: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await spawnFileWithInput("docker", args, "", {
      ...options,
      onTimeout: () => cleanupDockerContainer(containerName),
      killGraceMs: 1_000
    });
  } finally {
    await cleanupDockerContainer(containerName);
  }
}

function dockerContainerName(path: string, suffix: string): string {
  return `smith-bench-${basename(path)}-${suffix}`.replace(/[^A-Za-z0-9_.-]/g, "-");
}

async function cleanupDockerContainer(containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await execFileAsync("docker", ["kill", containerName], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024
      });
    } catch {
      // The container may already be stopped or removed.
    }
    await killDockerContainerPid(containerName);
    try {
      await execFileAsync("docker", ["rm", "-f", containerName], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      });
    } catch {
      // The container is usually already gone because docker run used --rm.
    }
    if (!(await dockerContainerExists(containerName))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function killDockerContainerPid(containerName: string): Promise<void> {
  try {
    const result = await execFileAsync("docker", ["inspect", "--format", "{{.State.Pid}}", containerName], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    const pid = Number.parseInt(result.stdout.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Docker may already have removed the container, or the host PID may be owned by another user.
  }
}

async function dockerContainerExists(containerName: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["container", "inspect", containerName], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
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

export function parseSmithTraceUsage(tracePath: string | undefined): BenchmarkUsage | undefined {
  if (!tracePath || !existsSync(tracePath)) return undefined;
  let current: Partial<BenchmarkUsage> | undefined;
  let total: BenchmarkUsage | undefined;
  for (const line of readFileSync(tracePath, "utf8").split(/\r?\n/)) {
    if (line === "## model usage" || line === "## danger review usage") {
      current = {};
      continue;
    }
    if (!current) continue;
    const [key, rawValue] = splitTraceUsageLine(line);
    if (!key) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    if (key === "input_tokens") current.inputTokens = value;
    else if (key === "cached_input_tokens") current.cachedInputTokens = value;
    else if (key === "output_tokens") current.outputTokens = value;
    else if (key === "reasoning_output_tokens") current.reasoningOutputTokens = value;
    else if (key === "total_tokens") {
      current.totalTokens = value;
      total = addBenchmarkUsageValues(total, normalizeUsage(current));
      current = undefined;
    }
  }
  return total;
}

function splitTraceUsageLine(line: string): [string, string] | [] {
  const index = line.indexOf(":");
  if (index === -1) return [];
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function addBenchmarkUsageValues(left: BenchmarkUsage | undefined, right: BenchmarkUsage | undefined): BenchmarkUsage | undefined {
  if (!right) return left;
  return {
    inputTokens: (left?.inputTokens ?? 0) + right.inputTokens,
    cachedInputTokens: (left?.cachedInputTokens ?? 0) + right.cachedInputTokens,
    outputTokens: (left?.outputTokens ?? 0) + right.outputTokens,
    reasoningOutputTokens: (left?.reasoningOutputTokens ?? 0) + right.reasoningOutputTokens,
    totalTokens: (left?.totalTokens ?? 0) + right.totalTokens
  };
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
  const costUsd = rates ? calculateCost(usage, rates) : usage.costUsd;
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

function errorStderr(failed: { stderr?: string }, error: unknown): string {
  return failed.stderr && failed.stderr.length > 0
    ? failed.stderr
    : error instanceof Error
      ? error.message
      : String(error);
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

export function spawnFileWithInput(
  command: string,
  args: string[],
  input: string,
  options: {
    timeout: number;
    maxBuffer: number;
    env?: NodeJS.ProcessEnv;
    onTimeout?: () => void | Promise<void>;
    killGraceMs?: number;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;
    let timedOut = false;
    let bufferError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const collectOutput = () => ({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    });
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      void Promise.resolve(options.onTimeout?.()).catch(() => undefined);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, options.killGraceMs ?? 5_000);
      killTimer.unref?.();
    }, options.timeout);

    const collect = (chunks: Buffer[], length: number, chunk: Buffer): number => {
      const nextLength = length + chunk.length;
      if (nextLength > options.maxBuffer && !settled) {
        bufferError = new Error(`${command} exceeded maxBuffer`);
        child.kill("SIGTERM");
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
      if (killTimer) clearTimeout(killTimer);
      reject(Object.assign(error, collectOutput()));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const output = collectOutput();
      if (timedOut) reject(Object.assign(new Error(`${command} timed out after ${options.timeout}ms`), output));
      else if (bufferError) reject(Object.assign(bufferError, output));
      else if (code === 0) resolve(output);
      else reject(Object.assign(new Error(`${command} exited with code ${code}`), output));
    });
    child.stdin.end(input);
  });
}
