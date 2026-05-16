import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BenchmarkTaskResult = {
  task: string;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  traceDir: string;
  sandboxDir: string;
};

export type BenchmarkRunOptions = {
  profile?: string;
  image?: string;
  timeoutMs?: number;
  keepSandbox?: boolean;
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

  const started = Date.now();
  const image = options.image ?? "node:22-bookworm";
  const profileArgs = options.profile ? ["--profile", options.profile] : [];
  const script = [
    "set -euo pipefail",
    "mkdir -p /home/smith",
    "TASK=$(cat /task/Task.md)",
    `node /smith/bin/smith.js --cwd /workspace ${profileArgs.map(shellQuote).join(" ")} "$TASK" > /tmp/smith.stdout 2> /tmp/smith.stderr`,
    "cd /workspace",
    "bash /task/verify.sh",
    "cat /tmp/smith.stdout",
    "cat /tmp/smith.stderr >&2"
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
    const taskResult = {
      task,
      passed: true,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
      traceDir: join(home, ".smith", "runs"),
      sandboxDir: sandbox
    };
    if (!options.keepSandbox) cleanupSandbox(sandbox);
    return taskResult;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return {
      task,
      passed: false,
      durationMs: Date.now() - started,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? String(error),
      traceDir: join(home, ".smith", "runs"),
      sandboxDir: sandbox
    };
  }
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
