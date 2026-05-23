import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Smith CLI integration", () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  it("runs against a fake OpenAI-chat provider and stops on finish", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "cat README.md" } },
      { name: "finish", arguments: { message: "Read fake project" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-e2e-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "README.md"), "fake project\n", "utf8");
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
api_key_env = "FAKE_KEY"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
`,
      "utf8"
    );

    const { stdout, stderr } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect README"], {
      env: { ...process.env, HOME: home, FAKE_KEY: "test" },
      timeout: 10_000
    });

    expect(stderr).toBe("");
    expect(stdout).toContain("fake project");
    expect(stdout).toContain("Read fake project");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0].headers.authorization).toBe("Bearer test");
    expect(messages(provider.requests[0].body)[0].role).toBe("system");
    expect((provider.requests[0].body as { tools?: unknown[] }).tools).toHaveLength(4);
    expect(systemMessage(provider.requests[0].body)).not.toContain("Task memory from SMITH.TASK.md");
    expect(userMessages(provider.requests[0].body)).toContain("inspect README");
    expect(userMessages(provider.requests[0].body)).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(messages(provider.requests[1].body).map((message) => message.role)).toEqual([
      "system",
      "user",
      "user",
      "assistant",
      "user"
    ]);
    expect(messages(provider.requests[1].body)[2].content).toContain("run: test tool call");
    expect(messages(provider.requests[1].body)[3].content).toBe("cat README.md");
    expect(messages(provider.requests[1].body)[4].content).toContain("fake project");
    expect(existsSync(join(cwd, "SMITH.TASK.md"))).toBe(false);
  });

  it("attempts a startup rg bootstrap and warns the main agent when rg remains unavailable", async () => {
    const provider = await startFakeProvider([
      { name: "finish", arguments: { message: "rg remains unavailable" } },
      { name: "finish", arguments: { message: "main done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-rg-bootstrap-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    const pathWithoutRg = mkdtempSync(join(tmpdir(), "smith-no-rg-path-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
shell = "/bin/bash"
danger_review = "off"
timeout_ms = 5000
`,
      "utf8"
    );

    const { stdout } = await execFileAsync(process.execPath, [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "main task"], {
      env: { ...process.env, HOME: home, PATH: pathWithoutRg },
      timeout: 10_000
    });

    expect(stdout).toContain("main done");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[0].body)).toContain("ripgrep (`rg`) is not available");
    expect(userMessages(provider.requests[0].body)).toContain("Do not use hacks");
    expect(systemMessage(provider.requests[0].body)).not.toContain("Environment note: the `rg` command is not available");
    expect(systemMessage(provider.requests[1].body)).toContain("Environment note: the `rg` command is not available");
    const traceDir = join(home, ".smith", "runs");
    const trace = readFileSync(join(traceDir, readdirSync(traceDir)[0]), "utf8");
    expect(trace).toContain("## ripgrep startup check");
    expect(trace).toContain("available_after_bootstrap: false");
  });

  it("applies patch tool calls without exposing patch contents in the transcript", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-patch-tool-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch note"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Applied patch to note.txt");
    expect(stdout).toContain("patched");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(messages(provider.requests[1].body)[3].content).toBe("patch");
    expect(messages(provider.requests[1].body)[4].content).toContain("Applied patch to note.txt");
    expect(messages(provider.requests[1].body)[3].content).not.toContain("Begin Patch");
  });

  it("applies tab-indented patch tool calls without shell tab completion", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: main.go",
            "@@",
            " func main() {",
            '-\tprintln("old")',
            '+\tprintln("new")',
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-patch-tabs-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "main.go"), 'func main() {\n\tprintln("old")\n}\n', "utf8");
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch go file"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Applied patch to main.go");
    expect(readFileSync(join(cwd, "main.go"), "utf8")).toBe('func main() {\n\tprintln("new")\n}\n');
    expect(messages(provider.requests[1].body)[3].content).toBe("patch");
    expect(messages(provider.requests[1].body)[4].content).not.toContain("smith_patch <<");
  });

  it("records transcript compaction without refreshing the system prompt", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "printf first" } },
      { name: "run", arguments: { command: "printf '%s\\n' 'Updated task fact' > SMITH.TASK.md" } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-refresh-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
max_context_tokens = 800
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "track task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(3);
    expect(systemMessage(provider.requests[2].body)).toContain("SMITH.TASK.md");
    expect(systemMessage(provider.requests[2].body)).not.toContain("Updated task fact");
    const traceDir = join(home, ".smith", "runs");
    const trace = readFileSync(join(traceDir, readdirSync(traceDir)[0]), "utf8");
    expect(trace).toContain("## transcript compacted");
    expect(trace).not.toContain("## system prompt refreshed");
    expect(existsSync(join(cwd, "SMITH.TASK.md"))).toBe(false);
  });

  it("starts sub_agent runs with inherited context by default", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "printf parent-output" } },
      { name: "sub_agent", arguments: { task: "inspect from child" } },
      { name: "finish", arguments: { message: "child answer" } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-inherit-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("parent done");
    expect(provider.requests).toHaveLength(4);
    const childBody = provider.requests[2].body;
    const childUserMessages = userMessages(childBody);
    const childLastMessage = messages(childBody).at(-1);
    expect(childUserMessages).toContain("parent task");
    expect(childUserMessages).toContain("parent-output");
    expect(childUserMessages).toContain("inspect from child");
    expect(childUserMessages).not.toContain("sub_agent: test tool call");
    expect(childLastMessage?.role).toBe("user");
    expect(childLastMessage?.content).toContain("only objective");
    expect(childLastMessage?.content).toContain("Sub-agent task:");
    expect(childLastMessage?.content).toContain("inspect from child");
  });

  it("can disable inherited context for sub_agent runs", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "printf parent-output" } },
      { name: "sub_agent", arguments: { task: "inspect from child" } },
      { name: "finish", arguments: { message: "child answer" } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-fresh-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
sub_agent_inherit_context = false
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("parent done");
    expect(provider.requests).toHaveLength(4);
    const childUserMessages = userMessages(provider.requests[2].body);
    expect(childUserMessages).toContain("inspect from child");
    expect(childUserMessages).not.toContain("parent task");
    expect(childUserMessages).not.toContain("parent-output");
  });

  it("can disable the sub_agent tool for a run", async () => {
    const provider = await startFakeProvider([{ name: "finish", arguments: { message: "direct done" } }]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-disabled-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
sub_agent_enabled = false
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("direct done");
    expect(provider.requests).toHaveLength(1);
    expect(toolNames(provider.requests[0].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[0].body)).toContain("Sub-agent delegation is disabled for this run");
  });

  it("sub_agent runs use the configured cap instead of model-provided caps", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "inspect from child", max_turns: 1 } },
      { name: "run", arguments: { command: "printf child-output" } },
      { name: "finish", arguments: { message: "child answer" } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-max-turns-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
max_turns = 4
sub_agent_max_turns = 2
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("parent done");
    expect(provider.requests).toHaveLength(4);
  });

  it("counts usage from sub_agent runs that fail before finish", async () => {
    const provider = await startFakeProvider(
      [
        { name: "sub_agent", arguments: { task: "inspect from child" } },
        { name: "run", arguments: { command: "printf child-output-1" } },
        { name: "run", arguments: { command: "printf child-output-2" } },
        { name: "finish", arguments: { message: "parent done" } }
      ],
      {
        prompt_tokens: 10,
        prompt_tokens_details: { cached_tokens: 6 },
        completion_tokens: 5,
        completion_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 15
      }
    );
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-failed-usage-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
max_turns = 2
`,
      "utf8"
    );

    const { stdout } = await execFileAsync(
      "node",
      [join(process.cwd(), "bin/smith.js"), "--quiet", "--json", "--cwd", cwd, "parent task"],
      { env: { ...process.env, HOME: home }, timeout: 10_000 }
    );

    const parsed = JSON.parse(stdout);
    expect(parsed.chatOut).toBe("parent done");
    expect(parsed.usage).toMatchObject({
      inputTokens: 40,
      cachedInputTokens: 24,
      outputTokens: 20,
      reasoningOutputTokens: 8,
      totalTokens: 60
    });
    expect(provider.requests).toHaveLength(4);
  });

  it("does not expose sub_agent inside child runs once max sub-agent depth is reached", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "inspect from child" } },
      { name: "sub_agent", arguments: { task: "inspect from grandchild" } },
      { name: "finish", arguments: { message: "grandchild answer" } },
      { name: "finish", arguments: { message: "child answer" } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-depth-tools-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
max_turns = 6
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("parent done");
    expect(provider.requests).toHaveLength(5);
    expect(toolNames(provider.requests[0].body)).toContain("sub_agent");
    expect(toolNames(provider.requests[1].body)).toContain("sub_agent");
    expect(toolNames(provider.requests[2].body)).toEqual(["run", "patch", "finish"]);
  });

  it("infers read-only sub_agent runs from do-not-edit tasks and removes patch", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "Identify relevant files. Do not edit files." } },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "child report" } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-readonly-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("parent done");
    expect(provider.requests).toHaveLength(4);
    expect(systemMessage(provider.requests[1].body)).toContain("Read-only mode is active");
    expect(toolNames(provider.requests[1].body)).toEqual(["run", "sub_agent", "finish"]);
    expect(userMessages(provider.requests[2].body)).toContain("Unknown or unavailable tool 'patch'");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("old\n");
  });

  it("truncates oversized run output before replaying it to the provider", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "node -e \"process.stdout.write('A'.repeat(500))\"" } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-tool-output-cap-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
max_tool_output_chars = 180
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "print a lot"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    const replayedOutput = messages(provider.requests[1].body).at(-1)?.content ?? "";
    expect(stdout).toContain("smith truncated tool output");
    expect(replayedOutput).toContain("smith truncated tool output");
    expect(replayedOutput).toContain("omitted");
    expect(replayedOutput.length).toBeLessThan(230);
    expect(replayedOutput).not.toContain("A".repeat(250));
  });

  it("truncates oversized sub_agent output before replaying it to the parent provider", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "inspect from child" } },
      { name: "finish", arguments: { message: "B".repeat(500) } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-output-cap-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 5000
max_tool_output_chars = 180
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    const replayedOutput = messages(provider.requests[2].body).at(-1)?.content ?? "";
    expect(stdout).toContain("parent done");
    expect(replayedOutput).toContain("smith truncated tool output");
    expect(replayedOutput).toContain("omitted");
    expect(replayedOutput.length).toBeLessThan(230);
    expect(replayedOutput).not.toContain("B".repeat(250));
  });

  it("remote prints only first finish message to stdout and supports resume", async () => {
    const provider = await startFakeProvider([
      { name: "finish", arguments: { message: "need info" } },
      { name: "finish", arguments: { message: "resumed" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-remote-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
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
    writeFileSync(join(cwd, "SMITH.TASK.md"), "Parent task context", "utf8");

    const first = await execFileAsync(
      "node",
      [join(process.cwd(), "bin/smith.js"), "remote", "--cwd", cwd, "inspect", "state"],
      { env: { ...process.env, HOME: home }, timeout: 10_000 }
    );
    expect(first.stdout).toBe("need info\n");
    expect(first.stderr).toMatch(/smith remote session saved: [a-z0-9_-]{6}/);
    expect(systemMessage(provider.requests[0].body)).toContain("SMITH.TASK.md");
    expect(systemMessage(provider.requests[0].body)).not.toContain("Parent task context");
    expect(userMessages(provider.requests[0].body)).toContain("Local SMITH.TASK.md exists");
    expect(existsSync(join(cwd, "SMITH.TASK.md"))).toBe(true);
    const id = /saved: ([a-z0-9_-]{6})/.exec(first.stderr)?.[1];
    expect(id).toBeTruthy();

    const resumed = await execFileAsync(
      "node",
      [join(process.cwd(), "bin/smith.js"), "remote", "--quiet", "--cwd", cwd, "--resume", id!, "continue"],
      { env: { ...process.env, HOME: home }, timeout: 10_000 }
    );
    expect(resumed.stdout).toBe("resumed\n");
    expect(resumed.stderr).toBe("");

    const listed = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "remote", "list", "--json"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });
    expect(JSON.parse(listed.stdout)[0]).toMatchObject({ id, profile: "fake", lastPrompt: "continue" });
  });

  it("supports quiet JSON output for normal runs", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "printf hidden" } },
      { name: "finish", arguments: { message: "visible" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-json-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
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

    const { stdout } = await execFileAsync(
      "node",
      [join(process.cwd(), "bin/smith.js"), "--quiet", "--json", "--cwd", cwd, "inspect"],
      { env: { ...process.env, HOME: home }, timeout: 10_000 }
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.chatOut).toBe("visible");
    expect(stdout).not.toContain("hidden");
  });
});

type FakeToolCall = {
  name: "run" | "patch" | "sub_agent" | "finish";
  arguments: Record<string, unknown>;
};

async function startFakeProvider(toolCalls: FakeToolCall[], usage?: Record<string, unknown>): Promise<{
  baseUrl: string;
  requests: Array<{ headers: Record<string, string | string[] | undefined>; body: unknown }>;
  server: { close: (callback: () => void) => void };
}> {
  const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: unknown }> = [];
  let count = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      requests.push({ headers: request.headers, body: JSON.parse(body) });
      const toolCall = toolCalls[Math.min(count, toolCalls.length - 1)];
      count += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: `call_${count}`,
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

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests, server };
}

function systemMessage(body: unknown): string {
  const messages = (body as { messages?: Array<{ role?: string; content?: string }> }).messages ?? [];
  return messages.find((message) => message.role === "system")?.content ?? "";
}

function userMessages(body: unknown): string {
  return messages(body)
    .filter((message) => message.role === "user")
    .map((message) => message.content ?? "")
    .join("\n");
}

function messages(body: unknown): Array<{ role?: string; content?: string }> {
  return (body as { messages?: Array<{ role?: string; content?: string }> }).messages ?? [];
}

function toolNames(body: unknown): string[] {
  const tools = (body as { tools?: Array<{ name?: string; function?: { name?: string } }> }).tools ?? [];
  return tools.map((tool) => tool.name ?? tool.function?.name).filter((name): name is string => Boolean(name));
}
