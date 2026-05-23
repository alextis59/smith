import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  BENCHMARK_TASK_INSTRUCTIONS,
  BENCHMARK_PYTHON_SHIM_SCRIPT,
  DEFAULT_SMITH_BENCHMARK_IMAGE,
  SWE_BENCH_PRO_TASK_INSTRUCTIONS,
  buildSmithBenchmarkDockerArgs,
  buildSweBenchProVerifierDockerArgs,
  buildSweBenchProSmithScript,
  buildSweBenchProVerifierScript,
  hideSweBenchProGitDir,
  parseSmithTraceUsage,
  restoreSweBenchProGitDir,
  resolveBenchmarkTarget,
  runBenchmarkTask,
  runTasksWithConcurrency,
  spawnFileWithInput,
  validateBenchmarkPath
} from "../src/benchmark/runner.js";

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe("Docker benchmark runner", () => {
  const servers: Array<{ close: (callback: () => void) => void; closeAllConnections?: () => void }> = [];

  afterEach(async () => {
    servers.forEach((server) => server.closeAllConnections?.());
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  it.skipIf(!hasDocker)("runs a minimal passing task in Docker", async () => {
    const provider = await startFakeProvider(
      [
        { name: "run", arguments: { command: "printf done > result.txt" } },
        { name: "finish", arguments: { message: "done" } }
      ],
      {
        prompt_tokens: 1000,
        prompt_tokens_details: { cached_tokens: 800 },
        completion_tokens: 500,
        completion_tokens_details: { reasoning_tokens: 300 },
        total_tokens: 1500
      },
      {
        bootstrapToolCall: { name: "finish", arguments: { message: "rg remains unavailable" } }
      }
    );
    servers.push(provider.server);

    const task = mkdtempSync(join(tmpdir(), "smith-benchmark-task-"));
    mkdirSync(join(task, "workspace", ".smith"), { recursive: true });
    writeFileSync(join(task, "Task.md"), "Create result.txt containing done.", "utf8");
    writeFileSync(
      join(task, "workspace", ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
`,
      "utf8"
    );
    writeFileSync(join(task, "verify.sh"), "test \"$(cat result.txt)\" = done\n", "utf8");
    chmodSync(join(task, "verify.sh"), 0o755);

    const result = await runBenchmarkTask(task, {
      timeoutMs: 120_000,
      cost: {
        inputCostPerMillionTokens: 1,
        cachedInputCostPerMillionTokens: 0.1,
        outputCostPerMillionTokens: 2
      }
    });
    expect(result.passed, result.stderr).toBe(true);
    expect(result.stdout).toContain("done");
    const providerTurns = provider.requests.length;
    expect(result.usage).toEqual({
      inputTokens: 1000 * providerTurns,
      cachedInputTokens: 800 * providerTurns,
      outputTokens: 500 * providerTurns,
      reasoningOutputTokens: 300 * providerTurns,
      totalTokens: 1500 * providerTurns,
      costUsd: Number((0.00128 * providerTurns).toFixed(8))
    });
  }, 180_000);

  it("runs timeout cleanup hooks before force-killing a spawned benchmark process", async () => {
    let cleanupCalled = false;

    await expect(
      spawnFileWithInput(
        process.execPath,
        ["-e", "setTimeout(() => {}, 30000)"],
        "",
        {
          timeout: 50,
          maxBuffer: 1024 * 1024,
          onTimeout: () => {
            cleanupCalled = true;
          },
          killGraceMs: 10
        }
      )
    ).rejects.toThrow("timed out after 50ms");
    expect(cleanupCalled).toBe(true);
  });

  it("validates benchmark task structure", () => {
    const task = mkdtempSync(join(tmpdir(), "smith-benchmark-invalid-"));
    writeFileSync(join(task, "Task.md"), "Do it.", "utf8");
    const [result] = validateBenchmarkPath(task);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing workspace");
    expect(result.errors).toContain("missing verify.sh");
  });

  it("parses accumulated Smith usage from traces when run JSON is unavailable", () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-usage-trace-"));
    const trace = join(cwd, "run.trace");
    writeFileSync(
      trace,
      `
## model usage
input_tokens: 1000
cached_input_tokens: 600
output_tokens: 200
reasoning_output_tokens: 150
total_tokens: 1200

## terminal output
done

## danger review usage
input_tokens: 300
cached_input_tokens: 100
output_tokens: 20
reasoning_output_tokens: 0
total_tokens: 320
`,
      "utf8"
    );

    expect(parseSmithTraceUsage(trace)).toEqual({
      inputTokens: 1300,
      cachedInputTokens: 700,
      outputTokens: 220,
      reasoningOutputTokens: 150,
      totalTokens: 1520
    });
  });

  it("validates SWE-bench Pro task structure", () => {
    const task = mkdtempSync(join(tmpdir(), "smith-swe-pro-task-"));
    writeFileSync(join(task, "Task.md"), "Fix the bug.", "utf8");
    writeFileSync(
      join(task, "task.json"),
      JSON.stringify({
        format: "swe-bench-pro-v1",
        repo: "owner/repo",
        instanceId: "instance_owner__repo-abc",
        baseCommit: "abc123",
        repoLanguage: "python",
        dockerImage: "example/image:tag",
        selectedTestFilesToRun: ["tests/test_feature.py"],
        failToPass: ["tests/test_feature.py | test fails then passes"],
        passToPass: ["tests/test_feature.py | test existing behavior"]
      }),
      "utf8"
    );
    writeFileSync(join(task, "run_script.sh"), "#!/usr/bin/env bash\n", "utf8");
    writeFileSync(join(task, "parser.py"), "print('parser')\n", "utf8");

    const [result] = validateBenchmarkPath(task);
    expect(result.valid, result.errors.join("; ")).toBe(true);
  });

  it("resolves named benchmark datasets separately from the local suite", () => {
    const resolved = resolveBenchmarkTarget("swe-bench-pro");
    expect(resolved).toMatch(/benchmark-datasets\/swe-bench-pro$/);
    expect(validateBenchmarkPath("swe-bench-pro")).toHaveLength(10);
    expect(resolveBenchmarkTarget("swe-bench-pro/001-nodebb-nodebb-vnan")).toMatch(
      /benchmark-datasets\/swe-bench-pro\/tasks\/001-nodebb-nodebb-vnan$/
    );
  });

  it("runs benchmark tasks with bounded concurrency while preserving result order", async () => {
    let active = 0;
    let maxActive = 0;
    const started: number[] = [];

    const results = await runTasksWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, (6 - item) * 5));
      active -= 1;
      return `result-${item}`;
    });

    expect(maxActive).toBe(2);
    expect(started.slice(0, 2)).toEqual([1, 2]);
    expect(results).toEqual(["result-1", "result-2", "result-3", "result-4", "result-5"]);
  });

  it("rejects invalid benchmark concurrency", async () => {
    await expect(runTasksWithConcurrency(["task"], 0, async (item) => item)).rejects.toThrow(
      "benchmark concurrency must be a positive integer"
    );
  });

  it("nudges agents away from optional status self-checks", () => {
    expect(BENCHMARK_TASK_INSTRUCTIONS).toContain(
      "When the task names implementation paths, functions, methods, or interfaces, treat those as primary source-code targets; do not satisfy the task with only documentation, localization, fixture, test, build, or generated-file changes unless those are explicitly requested."
    );
    expect(BENCHMARK_TASK_INSTRUCTIONS).toContain(
      "After a focused edit, run the verifier directly; avoid optional status, diff, or .git self-checks unless diagnosing a concrete failure."
    );
    expect(BENCHMARK_TASK_INSTRUCTIONS).toContain(
      "After an edit command, read its terminal result. If the command failed or might not have changed files, recover immediately and confirm the intended files changed with a targeted file read or path-specific diff before continuing."
    );
    expect(BENCHMARK_TASK_INSTRUCTIONS).toContain(
      "Do not read /task/verify.sh before the first verifier run; inspect it only after a verifier failure or when you are blocked."
    );
  });

  it("does not add SWE-bench Pro-specific coaching instructions", () => {
    expect(SWE_BENCH_PRO_TASK_INSTRUCTIONS).toEqual([]);
  });

  it("hides SWE-bench Pro git history from editing agents and restores it for verification", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "smith-swe-git-sandbox-"));
    const workspace = join(sandbox, "workspace");
    mkdirSync(join(workspace, ".git"), { recursive: true });
    writeFileSync(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n");

    const hidden = hideSweBenchProGitDir(workspace, sandbox);

    expect(hidden).toBe(join(sandbox, "workspace.git"));
    expect(existsSync(join(workspace, ".git"))).toBe(false);
    expect(existsSync(join(sandbox, "workspace.git", "HEAD"))).toBe(true);

    restoreSweBenchProGitDir(workspace, hidden);

    expect(existsSync(join(workspace, ".git", "HEAD"))).toBe(true);
    expect(existsSync(join(sandbox, "workspace.git"))).toBe(false);
  });

  it("adds tool shims for benchmark editing containers with missing basics", () => {
    const script = BENCHMARK_PYTHON_SHIM_SCRIPT.join("\n");

    expect(script).toContain("command -v python3");
    expect(script).toContain("ln -sf \"$(command -v python3)\" \"$SHIM_DIR/python\"");
    expect(script).toContain("if ! command -v rg >/dev/null 2>&1; then");
    expect(script).toContain("grep_args=(-E -H)");
    expect(script).toContain("-g|--glob)");
    expect(script).toContain("find \"${paths[@]}\" -type f -print0");
    expect(script).toContain("export PATH=\"$SHIM_DIR:$PATH\"");
  });

  it("creates an rg fallback that supports common search globs and regex groups", () => {
    const dir = mkdtempSync(join(tmpdir(), "smith-rg-shim-"));
    const resultDir = join(dir, "result");
    const workspace = join(dir, "workspace");
    mkdirSync(join(workspace, "pkg"), { recursive: true });
    writeFileSync(join(workspace, "pkg", "main.go"), "func NewForwarder() {}\nfunc ServeHTTP() {}\n", "utf8");
    writeFileSync(join(workspace, "pkg", "main.txt"), "NewForwarder text\n", "utf8");

    const script = [
      "set -euo pipefail",
      `RESULT_DIR=${JSON.stringify(resultDir)}`,
      ...BENCHMARK_PYTHON_SHIM_SCRIPT
    ].join("\n");
    const setup = spawnSync("bash", ["-lc", script], { cwd: workspace, encoding: "utf8" });

    expect(setup.status, setup.stderr).toBe(0);

    const search = spawnSync(
      "bash",
      [
        "-lc",
        `PATH=${JSON.stringify(join(resultDir, "bin"))}:$PATH rg -n -g '*.go' 'NewForwarder\\(|ServeHTTP' .`
      ],
      { cwd: workspace, encoding: "utf8" }
    );

    expect(search.status, search.stderr).toBe(0);
    expect(search.stdout).toContain("./pkg/main.go:1:func NewForwarder() {}");
    expect(search.stdout).toContain("./pkg/main.go:2:func ServeHTTP() {}");
    expect(search.stdout).not.toContain("main.txt");
  });

  it("prepares SWE-bench Pro Smith containers to use task-image tool paths", () => {
    const script = buildSweBenchProSmithScript(
      {
        format: "swe-bench-pro-v1",
        repo: "owner/repo",
        instanceId: "instance_owner__repo-abc",
        baseCommit: "abc123",
        repoLanguage: "go",
        dockerImage: "example/image:tag",
        selectedTestFilesToRun: ["TestFeature"],
        failToPass: ["TestFeature"],
        passToPass: []
      },
      "node /smith/bin/smith.js --cwd /workspace --quiet --json \"$TASK\""
    );

    expect(script).toContain("export PATH=/usr/local/go/bin:/go/bin:$PATH");
    expect(script).toContain("node /smith/bin/smith.js --cwd /workspace --quiet --json \"$TASK\"");
  });

  it("runs SWE-bench Pro Smith containers through a bash entrypoint", () => {
    const args = buildSmithBenchmarkDockerArgs({
      containerName: "smith-bench-test",
      image: DEFAULT_SMITH_BENCHMARK_IMAGE,
      repoRoot: "/repo",
      workspace: "/workspace-copy",
      home: "/home-copy",
      taskCopy: "/task-copy",
      script: "echo ok"
    });

    expect(args).toContain("--entrypoint");
    expect(args[args.indexOf("--entrypoint") + 1]).toBe("bash");
    expect(args.slice(-3)).toEqual([DEFAULT_SMITH_BENCHMARK_IMAGE, "-lc", "echo ok"]);
    expect(args).not.toContain("bash -lc");
  });

  it("runs SWE-bench Pro verifier containers through a bash entrypoint", () => {
    const args = buildSweBenchProVerifierDockerArgs({
      containerName: "smith-bench-verify-test",
      image: "example/image:tag",
      workspace: "/workspace-copy",
      taskCopy: "/task-copy",
      resultsDir: "/results-copy",
      script: "echo verify"
    });

    expect(args).toContain("--entrypoint");
    expect(args[args.indexOf("--entrypoint") + 1]).toBe("bash");
    expect(args.slice(-3)).toEqual(["example/image:tag", "-lc", "echo verify"]);
  });

  it("marks mounted SWE-bench Pro workspaces as safe for git before verification", () => {
    const script = buildSweBenchProVerifierScript({
      format: "swe-bench-pro-v1",
      repo: "owner/repo",
      instanceId: "instance_owner__repo-abc",
      baseCommit: "abc123",
      repoLanguage: "python",
      dockerImage: "example/image:tag",
      selectedTestFilesToRun: ["tests/test_feature.py"],
      failToPass: ["tests/test_feature.py | test fails then passes"],
      passToPass: ["tests/test_feature.py | test existing behavior"]
    });

    expect(script).toContain("git config --global --add safe.directory /app || true");
    expect(script).toContain("export PATH=/usr/local/go/bin:$PATH");
    expect(script.indexOf("export PATH=/usr/local/go/bin:$PATH")).toBeLessThan(script.indexOf("bash /task/run_script.sh"));
    expect(script.indexOf("git config --global --add safe.directory /app || true")).toBeLessThan(script.indexOf("cd /app"));
  });
});

type FakeToolCall = {
  name: "run" | "patch" | "sub_agent" | "finish";
  arguments: Record<string, unknown>;
};

async function startFakeProvider(
  toolCalls: FakeToolCall[],
  usage?: Record<string, unknown>,
  options: { bootstrapToolCall?: FakeToolCall } = {}
): Promise<{
  baseUrl: string;
  requests: unknown[];
  server: { close: (callback: () => void) => void };
}> {
  let count = 0;
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push(parsed);
      const bootstrapRequest = body.includes("ripgrep (`rg`) is not available");
      const toolCall =
        bootstrapRequest && options.bootstrapToolCall
          ? options.bootstrapToolCall
          : toolCalls[Math.min(count++, toolCalls.length - 1)];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: `call_${requests.length}`,
                    type: "function",
                    function: {
                      name: toolCall.name,
                      arguments: JSON.stringify({ reason: "test tool call", ...toolCall.arguments })
                    }
                  }
                ]
              }
            }
          ],
          ...(usage ? { usage } : {})
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");
  return { baseUrl: `http://host.docker.internal:${address.port}`, requests, server };
}
