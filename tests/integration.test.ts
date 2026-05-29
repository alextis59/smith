import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
max_turns = 30
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

  it("adds a generic checklist reminder for prompts with explicit requirements", async () => {
    const provider = await startFakeProvider([{ name: "finish", arguments: { message: "done" } }]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-checklist-reminder-"));
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
max_turns = 30
`,
      "utf8"
    );

    const prompt = ["Update the parser.", "", "## Requirements", "", "- Preserve existing behavior.", "- Add validation."].join(
      "\n"
    );
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(userMessages(provider.requests[0].body)).toContain("Track them as concrete todo items");
    expect(userMessages(provider.requests[0].body)).toContain("explicit requirements or checklist items");
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
      { name: "finish", arguments: { message: "patched; validation pending" } }
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
max_turns = 30
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
    expect(messages(provider.requests[1].body)[4].content).toContain("Task patch pending validation");
    expect(messages(provider.requests[1].body)[4].content).toContain("Inspection commands do not validate the patch");
    expect(messages(provider.requests[1].body)[3].content).not.toContain("Begin Patch");
  });

  it("warns when a patch changes likely test files", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: tests/note.test.js",
            "@@",
            "-console.log('old');",
            "+console.log('new');",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-test-file-patch-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "note.test.js"), "console.log('old');\n", "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch test"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patched");
    expect(messages(provider.requests[1].body)[4].content).toContain("Applied patch to tests/note.test.js");
    expect(messages(provider.requests[1].body)[4].content).toContain("Test files changed: tests/note.test.js");
    expect(messages(provider.requests[1].body)[4].content).toContain("Local validation may include the changed tests");
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
      { name: "finish", arguments: { message: "patched; validation pending" } }
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

  it("adds generic guidance for patch permission failures", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: readonly.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "reported" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-patch-readonly-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "readonly.txt"), "old\n", "utf8");
    chmodSync(join(cwd, "readonly.txt"), 0o444);
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch readonly"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patch failed: EACCES");
    expect(stdout).toContain("The target path is not writable in this workspace");
    expect(stdout).toContain("patch those instead of treating this path as the whole blocker");
    expect(readFileSync(join(cwd, "readonly.txt"), "utf8")).toBe("old\n");
  });

  it("adds source-compatibility guidance for unwritable test file patches", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: tests/readonly.test.js",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "reported" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-patch-readonly-test-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "readonly.test.js"), "old\n", "utf8");
    chmodSync(join(cwd, "tests", "readonly.test.js"), 0o444);
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch readonly test"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patch failed: EACCES");
    expect(stdout).toContain("The unwritable path appears to be a test or spec file");
    expect(stdout).toContain("treat the test as existing behavior to satisfy by changing source files");
    expect(readFileSync(join(cwd, "tests", "readonly.test.js"), "utf8")).toBe("old\n");
  });

  it("adds generic guidance for patch context mismatches", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-missing",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "reported" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-patch-context-"));
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

    expect(stdout).toContain("patch failed: hunk context not found");
    expect(stdout).toContain("Before retrying, inspect the exact current lines");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("old\n");
  });

  it("allows one short inspection after a post-deadline patch context mismatch", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-missing",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "sed -n '1,2p' note.txt", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "blocked after inspection" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-post-deadline-patch-context-"));
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
max_run_ms = 1
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch note"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("blocked after inspection");
    expect(provider.requests).toHaveLength(3);
    expect(toolNames(provider.requests[1].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[1].body)).toContain("post-deadline patch failed because its context did not match");
    expect(userMessages(provider.requests[2].body)).toContain("old");
    expect(userMessages(provider.requests[2].body)).not.toContain("Post-deadline run is reserved");
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
      { name: "finish", arguments: { message: "parent done; validation pending" } }
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
      { name: "finish", arguments: { message: "parent done; validation pending" } }
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
      { name: "finish", arguments: { message: "parent done; validation pending" } }
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
    expect(userMessages(provider.requests[3].body)).toContain("Recent failed sub-agent transcript tail");
    expect(userMessages(provider.requests[3].body)).toContain("child-output-1");
    expect(userMessages(provider.requests[3].body)).toContain("child-output-2");
  });

  it("hides sub_agent after a child run exhausts its turn budget until a task patch succeeds", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "inspect from child" } },
      { name: "run", arguments: { command: "printf child-output-1" } },
      { name: "run", arguments: { command: "printf child-output-2" } },
      { name: "sub_agent", arguments: { task: "retry delegated inspection" } },
      { name: "finish", arguments: { message: "parent done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-disable-after-fail-"));
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
max_turns = 3
sub_agent_max_turns = 2
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("parent done");
    expect(provider.requests).toHaveLength(5);
    expect(toolNames(provider.requests[3].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[3].body)).toContain(
      "A previous sub_agent child run did not finish within its turn budget"
    );
    expect(userMessages(provider.requests[4].body)).toContain("Unknown or unavailable tool 'sub_agent'");
  });

  it("disables sub_agent for the run after repeated child turn-limit failures", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "inspect from first child" } },
      { name: "run", arguments: { command: "printf child-output-1" } },
      { name: "run", arguments: { command: "printf child-output-2" } },
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
      { name: "sub_agent", arguments: { task: "inspect from second child" } },
      { name: "run", arguments: { command: "printf child-output-3" } },
      { name: "run", arguments: { command: "printf child-output-4" } },
      { name: "finish", arguments: { message: "parent done; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-disable-repeated-"));
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
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(provider.requests).toHaveLength(8);
    expect(toolNames(provider.requests[4].body)).toContain("sub_agent");
    expect(toolNames(provider.requests[7].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[7].body)).toContain(
      "Multiple sub_agent child runs did not finish within their turn budgets"
    );
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

  it("prefixes failed command output with a salient failure status", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "node -e \"process.stdout.write('details'); process.exit(7)\"" } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-command-failure-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "run failing command"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    const replayedOutput = messages(provider.requests[1].body).at(-1)?.content ?? "";
    expect(replayedOutput).toContain("Command failed with exit status 7.");
    expect(replayedOutput).toContain("details");
    expect(replayedOutput).toContain("exit_status: 7");
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

  it("adds a generic progress reminder after sustained inspection without edits", async () => {
    const provider = await startFakeProvider([
      ...Array.from({ length: 12 }, (_, index) => ({
        name: "run" as const,
        arguments: { command: `printf output-${index}` }
      })),
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-progress-reminder-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect repeatedly"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(13);
    const reminderRequest = provider.requests[12].body;
    expect(userMessages(reminderRequest)).toContain("Smith progress: 12 tool calls have completed without a task patch or finish");
    const traceDir = join(home, ".smith", "runs");
    const trace = readFileSync(join(traceDir, readdirSync(traceDir)[0]), "utf8");
    expect(trace).toContain("## progress reminder");
  });

  it("temporarily disables inspection tools after repeated no-patch progress reminders", async () => {
    const provider = await startFakeProvider([
      ...Array.from({ length: 36 }, (_, index) => ({
        name: "run" as const,
        arguments: { command: `printf output-${index}` }
      })),
      { name: "run", arguments: { command: "printf should-not-run" } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-inspection-pause-"));
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
max_turns = 45
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect repeatedly"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(38);
    expect(toolNames(provider.requests[36].body)).toEqual(["patch", "finish"]);
    expect(systemMessage(provider.requests[36].body)).toContain(
      "Sustained inspection has continued without a task patch or finish"
    );
    expect(userMessages(provider.requests[36].body)).toContain("Smith progress: 36 tool calls have completed");
    expect(userMessages(provider.requests[37].body)).toContain("Unknown or unavailable tool 'run'");
  });

  it("does not reset progress reminders for memory-only patches", async () => {
    const provider = await startFakeProvider([
      ...Array.from({ length: 11 }, (_, index) => ({
        name: "run" as const,
        arguments: { command: `printf output-${index}` }
      })),
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Add File: SMITH.TASK.md",
            "+Current hypothesis: inspect the parser next.",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-memory-progress-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect repeatedly"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(13);
    const replayedOutput = userMessages(provider.requests[12].body);
    expect(replayedOutput).toContain("Applied patch to SMITH.TASK.md");
    expect(replayedOutput).not.toContain("Task patch pending validation");
    expect(replayedOutput).toContain("Smith progress: 12 tool calls have completed without a task patch or finish");
  });

  it("adds a generic deadline reminder near a configured max run time", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "sleep 0.02; printf output" } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-deadline-reminder-"));
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect once"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(2);
    const replayedOutput = userMessages(provider.requests[1].body);
    expect(replayedOutput).toContain("Smith deadline: elapsed");
    expect(replayedOutput).toContain("max run time (75% threshold)");
    const traceDir = join(home, ".smith", "runs");
    const trace = readFileSync(join(traceDir, readdirSync(traceDir)[0]), "utf8");
    expect(trace).toContain("## deadline reminder");
  });

  it("disables inspection tools after the configured max run time elapses", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "sleep 0.02; printf output" } },
      { name: "run", arguments: { command: "printf should-not-run" } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-deadline-finalize-"));
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(3);
    expect(toolNames(provider.requests[1].body)).toEqual(["patch", "finish"]);
    expect(systemMessage(provider.requests[1].body)).toContain("The configured max run time has elapsed");
    expect(userMessages(provider.requests[2].body)).toContain("Unknown or unavailable tool 'run'");
  });

  it("allows one bounded validation run after a post-deadline task patch", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "sleep 0.02; printf output" } },
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
      { name: "run", arguments: { command: "sed -n '1p' note.txt" } },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-post-deadline-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf checked" } }), "utf8");
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(5);
    expect(toolNames(provider.requests[1].body)).toEqual(["patch", "finish"]);
    expect(toolNames(provider.requests[2].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[2].body)).toContain("one bounded validation command");
    expect(userMessages(provider.requests[3].body)).toContain("Post-deadline run is reserved for validation commands");
    expect(toolNames(provider.requests[3].body)).toEqual(["run", "patch", "finish"]);
    expect(userMessages(provider.requests[4].body)).toContain("checked");
    expect(toolNames(provider.requests[4].body)).toEqual(["patch", "finish"]);
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
  });

  it("allows a compound inspection and validation command after a post-deadline task patch", async () => {
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
      { name: "run", arguments: { command: "sed -n '1p' note.txt && npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-compound-post-deadline-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf checked" } }), "utf8");
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(3);
    expect(toolNames(provider.requests[1].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[1].body)).toContain("one bounded validation command");
    expect(userMessages(provider.requests[2].body)).toContain("new");
    expect(userMessages(provider.requests[2].body)).toContain("checked");
    expect(userMessages(provider.requests[2].body)).not.toContain("Post-deadline run is reserved");
    expect(toolNames(provider.requests[2].body)).toEqual(["patch", "finish"]);
  });

  it("allows one bounded validation run when an unvalidated patch reaches the deadline", async () => {
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
      { name: "run", arguments: { command: "sed -n '1p' note.txt" } },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-unvalidated-deadline-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf checked" } }), "utf8");
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(4);
    expect(toolNames(provider.requests[1].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[1].body)).toContain("A task patch has not been validated");
    expect(userMessages(provider.requests[2].body)).toContain("Post-deadline run is reserved for validation commands");
    expect(userMessages(provider.requests[3].body)).toContain("checked");
    expect(toolNames(provider.requests[3].body)).toEqual(["patch", "finish"]);
  });

  it("keeps post-deadline validation available after a no-op validation command", async () => {
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
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "run", arguments: { command: "npm run verify --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-noop-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          test: "printf 'testing: warning: no tests to run\\nPASS\\n'",
          verify: "printf checked"
        }
      }),
      "utf8"
    );
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(4);
    expect(toolNames(provider.requests[1].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[1].body)).toContain("A task patch has not been validated");
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command appears to have run no tests");
    expect(toolNames(provider.requests[2].body)).toEqual(["run", "patch", "finish"]);
    expect(userMessages(provider.requests[3].body)).toContain("checked");
    expect(toolNames(provider.requests[3].body)).toEqual(["patch", "finish"]);
  });

  it("rejects finish claims that treat no-op validation as successful", async () => {
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
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "Validation passed with npm test." } },
      { name: "finish", arguments: { message: "Changed note.txt; validation pending because npm test ran no tests." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-noop-validation-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf 'no tests to run\\n'" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command appears to have run no tests");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: a previous validation command appeared to run no tests");
  });

  it("allows validation success claims after a later check runs tests", async () => {
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
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "run", arguments: { command: "npm run verify", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "Validation passed with npm run verify." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-noop-then-real-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "printf 'no tests to run\\n'", verify: "printf 'checked\\n'" } }),
      "utf8"
    );
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Validation passed");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command appears to have run no tests");
    expect(userMessages(provider.requests[3].body)).toContain("checked");
    expect(userMessages(provider.requests[3].body)).not.toContain(
      "Finish rejected: a previous validation command appeared to run no tests"
    );
  });

  it("keeps post-deadline validation available after a failed validation command", async () => {
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
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "run", arguments: { command: "npm run verify --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-failed-post-deadline-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          test: "printf failed; exit 1",
          verify: "printf checked"
        }
      }),
      "utf8"
    );
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(4);
    expect(toolNames(provider.requests[1].body)).toEqual(["run", "patch", "finish"]);
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
    expect(userMessages(provider.requests[2].body)).toContain("Inspect referenced files or failure locations");
    expect(toolNames(provider.requests[2].body)).toEqual(["run", "patch", "finish"]);
    expect(userMessages(provider.requests[3].body)).toContain("checked");
    expect(toolNames(provider.requests[3].body)).toEqual(["patch", "finish"]);
  });

  it("allows one short inspection after a failed post-deadline validation command", async () => {
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
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "run", arguments: { command: "cat note.txt", timeout_ms: 5000 } },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-new",
            "+newer",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm run verify --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-failed-post-deadline-inspection-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          test: "printf failed; exit 1",
          verify: "printf checked"
        }
      }),
      "utf8"
    );
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(6);
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
    expect(systemMessage(provider.requests[2].body)).toContain("one short inspection command");
    expect(userMessages(provider.requests[3].body)).toContain("new");
    expect(userMessages(provider.requests[5].body)).toContain("checked");
  });

  it("warns that failed validation does not validate a task patch", async () => {
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
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "blocked" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-failed-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf failed; exit 1" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("blocked");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain("Command failed with exit status 1.");
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
  });

  it("tracks edits made by run commands as pending validation", async () => {
    const provider = await startFakeProvider([
      {
        name: "run",
        arguments: {
          command: "node -e \"require('fs').writeFileSync('note.txt', 'new\\\\n')\"",
          timeout_ms: 5000
        }
      },
      { name: "finish", arguments: { message: "done" } },
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-run-edit-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "test.js"), "console.log('checked');\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "edit with run"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[1].body)).toContain("Run command changed tracked files: note.txt");
    expect(userMessages(provider.requests[1].body)).toContain("Task patch pending validation");
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: a task patch is still pending validation");
  });

  it("warns that selected test validation is narrow", async () => {
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
      { name: "run", arguments: { command: "npm test -- --grep selected", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } },
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-narrow-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "test.js"), "console.log('checked');\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(5);
    expect(userMessages(provider.requests[2].body)).toContain("checked");
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command selected a subset of checks");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: a task patch is still pending validation");
  });

  it("warns that explicit test-file validation is narrow", async () => {
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
      { name: "run", arguments: { command: "npm test -- tests/note.test.js", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } },
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-test-file-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "tests", "note.test.js"), "console.log('file checked');\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node tests/note.test.js" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(5);
    expect(userMessages(provider.requests[2].body)).toContain("file checked");
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command selected a subset of checks");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: a task patch is still pending validation");
  });

  it("warns that root test.js validation is narrow", async () => {
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
      { name: "run", arguments: { command: "node test.js", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "Changed note.txt; validation pending after only node test.js." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-root-test-file-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "test.js"), "console.log('file checked');\n", "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain("file checked");
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command selected a subset of checks");
  });

  it("keeps validation pending when go test misses changed source directories", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: pkg/a/a.go",
            "@@",
            "-package a",
            "+package a",
            "+",
            "+func A() string { return \"a\" }",
            "*** Update File: pkg/b/b.go",
            "@@",
            "-package b",
            "+package b",
            "+",
            "+func B() string { return \"b\" }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "go test ./pkg/a", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } },
      { name: "run", arguments: { command: "go test ./...", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-go-validation-coverage-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    const bin = join(cwd, "bin");
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "pkg", "a"), { recursive: true });
    mkdirSync(join(cwd, "pkg", "b"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(cwd, "pkg", "a", "a.go"), "package a\n", "utf8");
    writeFileSync(join(cwd, "pkg", "b", "b.go"), "package b\n", "utf8");
    writeFileSync(join(bin, "go"), "#!/bin/sh\necho 'ok  \texample.test/pkg\t0.001s'\n", "utf8");
    chmodSync(join(bin, "go"), 0o755);
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(5);
    expect(userMessages(provider.requests[2].body)).toContain(
      "Validation warning: this command did not appear to cover all changed source directories"
    );
    expect(userMessages(provider.requests[2].body)).toContain("pkg/b");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: a task patch is still pending validation");
  });

  it("warns when validation runs with modified tracked test files", async () => {
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
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-dirty-test-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "tests", "note.test.js"), "console.log('checked');\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node tests/note.test.js" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });
    writeFileSync(join(cwd, "tests", "note.test.js"), "console.log('changed test');\n", "utf8");

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain("changed test");
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: tracked test files are currently modified");
    expect(userMessages(provider.requests[2].body)).toContain("tests/note.test.js");
  });

  it("keeps validation pending when go test reuses cached results", async () => {
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
      { name: "run", arguments: { command: "go test ./pkg", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } },
      {
        name: "finish",
        arguments: {
          message: "Changed note.txt, but validation pending because go test reused cached results."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-cached-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    const bin = join(cwd, "bin");
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(bin, "go"), "#!/bin/sh\necho 'ok  \texample.test/pkg\t(cached)'\n", "utf8");
    chmodSync(join(bin, "go"), 0o755);
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ""}` },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command reused cached test results");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: a task patch is still pending validation");
  });

  it("allows unvalidated patch finish when the message reports pending validation", async () => {
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
      {
        name: "finish",
        arguments: {
          message: "Changed note.txt, but validation pending because the project test command is not practical here."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-unvalidated-finish-pending-"));
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch without validation"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(provider.requests).toHaveLength(2);
  });

  it("rejects unsupported read-only finish claims when patch is available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: "Blocked: I could not update note.txt because the repository is currently read-only."
        }
      },
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
      { name: "finish", arguments: { message: "patched; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-readonly-finish-"));
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch note"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patched");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Finish rejected: read-only mode is not active");
    expect(userMessages(provider.requests[1].body)).toContain("patch is available");
  });

  it("rejects unsupported validation-unavailable finish claims when run is available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: "I could not run the focused tests because the workspace switched to post-deadline mode and validation commands were unavailable."
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "validated" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-validation-unavailable-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf checked" } }), "utf8");
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "run validation"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validated");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Finish rejected: run is currently available");
    expect(userMessages(provider.requests[2].body)).toContain("checked");
  });

  it("allows read-only finish claims when transcript evidence supports them", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: readonly.txt",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message: "I could not update readonly.txt because the file is read-only."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-supported-readonly-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "readonly.txt"), "old\n", "utf8");
    chmodSync(join(cwd, "readonly.txt"), 0o444);
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch note"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patch failed: EACCES");
    expect(stdout).toContain("I could not update readonly.txt");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).not.toContain("Finish rejected: read-only mode is not active");
  });

  it("rejects completed finish claims after read-only test patch failures", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: tests/readonly.test.js",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message:
            "Implemented the source fix. Note: I could not update tests/readonly.test.js because it is read-only, but the relevant tests pass."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Partial result: tests/readonly.test.js is read-only, so the requested test update is blocked."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-readonly-test-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "readonly.test.js"), "old\n", "utf8");
    chmodSync(join(cwd, "tests", "readonly.test.js"), 0o444);
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch readonly test"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Partial result");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("The unwritable path appears to be a test or spec file");
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: a read-only test/spec patch failed");
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
