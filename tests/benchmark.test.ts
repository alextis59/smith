import { createServer } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  BENCHMARK_TASK_INSTRUCTIONS,
  buildSweBenchProVerifierScript,
  resolveBenchmarkTarget,
  runBenchmarkTask,
  validateBenchmarkPath
} from "../src/benchmark/runner.js";

const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe("Docker benchmark runner", () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  it.skipIf(!hasDocker)("runs a minimal passing task in Docker", async () => {
    const provider = await startFakeProvider(["printf done > result.txt", "chat_out \"done\""]);
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

    const result = await runBenchmarkTask(task, { timeoutMs: 120_000 });
    expect(result.passed, result.stderr).toBe(true);
    expect(result.stdout).toContain("done");
  }, 180_000);

  it("validates benchmark task structure", () => {
    const task = mkdtempSync(join(tmpdir(), "smith-benchmark-invalid-"));
    writeFileSync(join(task, "Task.md"), "Do it.", "utf8");
    const [result] = validateBenchmarkPath(task);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing workspace");
    expect(result.errors).toContain("missing verify.sh");
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
    expect(script.indexOf("git config --global --add safe.directory /app || true")).toBeLessThan(script.indexOf("cd /app"));
  });
});

async function startFakeProvider(commands: string[]): Promise<{
  baseUrl: string;
  server: { close: (callback: () => void) => void };
}> {
  let count = 0;
  const server = createServer((_request, response) => {
    _request.resume();
    const command = commands[Math.min(count, commands.length - 1)];
    count += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: command } }] }));
  });

  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");
  return { baseUrl: `http://host.docker.internal:${address.port}`, server };
}
