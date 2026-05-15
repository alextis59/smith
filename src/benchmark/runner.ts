import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
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
};

export type BenchmarkRunOptions = {
  profile?: string;
  image?: string;
  timeoutMs?: number;
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
  validateTask(task);
  const repoRoot = findRepoRoot();
  const sandbox = mkdtempSync(join(repoRoot, ".smith-bench-"));
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
    return {
      task,
      passed: true,
      durationMs: Date.now() - started,
      stdout: result.stdout,
      stderr: result.stderr,
      traceDir: join(home, ".smith", "runs")
    };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return {
      task,
      passed: false,
      durationMs: Date.now() - started,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? String(error),
      traceDir: join(home, ".smith", "runs")
    };
  }
}

function discoverTasks(path: string): string[] {
  const root = resolve(path);
  if (existsSync(join(root, "Task.md"))) return [root];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, "Task.md")));
}

function validateTask(task: string): void {
  for (const file of ["Task.md", "workspace", "verify.sh"]) {
    if (!existsSync(join(task, file))) throw new Error(`benchmark task missing ${file}: ${task}`);
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
