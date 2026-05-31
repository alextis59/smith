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

  it("rejects incomplete finish reports for prompts with explicit requirements", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: [
            "Completed one item.",
            "",
            "Remaining checklist items:",
            "- [ ] Add validation.",
            "- [ ] Preserve compatibility."
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "Cannot continue because the required dependency is missing from this environment." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-incomplete-requirements-finish-"));
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

    const prompt = ["Update the adapter.", "", "## Requirements", "", "- Add validation.", "- Preserve compatibility."].join(
      "\n"
    );
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Cannot continue");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain(
      "Finish rejected: the message claims the task is done while also reporting incomplete or blocked requested work"
    );
  });

  it("rejects non-external blockers for prompts with explicit requirements", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: [
            "Partial blocker:",
            "- Compatibility wrappers are still incomplete.",
            "- More source refactoring is still needed before the requested behavior is complete."
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Cannot continue because the required build tool is missing from this environment."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-explicit-requirements-blocker-"));
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

    const prompt = [
      "Refactor the adapter.",
      "",
      "## Requirements",
      "",
      "- Preserve existing callers.",
      "- Add validation."
    ].join("\n");
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Cannot continue");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain(
      "Finish rejected: the prompt has explicit requirements, and the finish message says requested items remain incomplete without a concrete external blocker"
    );
  });

  it("rejects approval-only blockers for requested breaking refactors", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: [
            "Blocker:",
            "The remaining requirements need a breaking API refactor across the adapter and call sites.",
            "Please approve the breaking compatibility change and I can continue."
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Cannot continue because the required build tool is missing from this environment."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-explicit-requirements-approval-blocker-"));
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

    const prompt = [
      "Refactor the adapter API.",
      "",
      "## Requirements",
      "",
      "- Rename the adapter config fields.",
      "- Update all call sites.",
      "- Preserve compatibility where practical."
    ].join("\n");
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Cannot continue");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain(
      "Finish rejected: patch is available and the prompt has explicit implementation requirements"
    );
    expect(userMessages(provider.requests[1].body)).toContain("Do not stop only to request approval");
  });

  it("allows explicit-requirement blockers for missing local command output samples", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: [
            "Blocked partial report:",
            "- Implemented: installed package parsing.",
            "- Incomplete: package index mapping.",
            "",
            "Concrete blocker:",
            "- This workspace has no apk command and no real apk index output sample, so I cannot verify the exact package-index format safely."
          ].join("\n")
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-explicit-requirements-missing-sample-"));
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

    const prompt = [
      "Update the package parser.",
      "",
      "## Requirements",
      "",
      "- Parse installed package output.",
      "- Parse package index mapping."
    ].join("\n");
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Blocked partial report");
    expect(provider.requests).toHaveLength(1);
  });

  it("allows incomplete explicit-requirement reports after a patch context blocker", async () => {
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
      {
        name: "finish",
        arguments: {
          message: [
            "Blocked partial report:",
            "- Implemented: no source changes were safely applied.",
            "- Still incomplete: preserve compatibility.",
            "",
            "Concrete blocker:",
            "- The patch context no longer matched note.txt, and there is not enough remaining run budget to safely re-anchor the broader change."
          ].join("\n")
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-explicit-requirements-patch-context-"));
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

    const prompt = ["Refactor note.txt.", "", "## Requirements", "", "- Preserve compatibility."].join("\n");
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Blocked partial report");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain("Patch context did not match the current file");
    expect(userMessages(provider.requests[1].body)).not.toContain(
      "Finish rejected: the prompt has explicit requirements"
    );
  });

  it("rejects finish reports that claim completion while reporting incomplete work", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: ["Done.", "", "Checklist:", "- [x] Update parser.", "- [ ] Preserve compatibility wrappers."].join("\n")
        }
      },
      { name: "finish", arguments: { message: "Partial blocker: compatibility wrappers are still incomplete." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-contradictory-finish-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "update parser"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Partial blocker");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain(
      "Finish rejected: the message claims the task is done while also reporting incomplete or blocked requested work"
    );
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

  it("rejects heredoc file rewrites through run", async () => {
    const provider = await startFakeProvider([
      {
        name: "run",
        arguments: {
          command: "cat > note.txt <<'EOF'\nnew\nEOF",
          timeout_ms: 5000
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
      {
        name: "finish",
        arguments: {
          message: "Changed note.txt; validation pending."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-heredoc-run-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "change note"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Run command rejected: heredoc-style file rewrites");
  });

  it("pauses run after repeated rejected file rewrites", async () => {
    const provider = await startFakeProvider([
      {
        name: "run",
        arguments: {
          command: "cat > note.txt <<'EOF'\nnew\nEOF",
          timeout_ms: 5000
        }
      },
      {
        name: "run",
        arguments: {
          command: "cat > ./note.txt <<'EOF'\nnew\nEOF",
          timeout_ms: 5000
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
      {
        name: "finish",
        arguments: {
          message: "Changed note.txt; validation pending."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-repeated-run-edit-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "change note"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Run command rejected: heredoc-style file rewrites");
    expect(toolNames(provider.requests[2].body)).toEqual(["patch", "finish"]);
    expect(systemMessage(provider.requests[2].body)).toContain("Repeated run commands attempted unsafe file rewrites");
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

  it("rejects empty finish messages", async () => {
    const provider = await startFakeProvider([
      { name: "finish", arguments: { message: "" } },
      { name: "finish", arguments: { message: "Done with a concrete final answer." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-empty-finish-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "finish normally"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("concrete final answer");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain("Finish rejected: missing non-empty final message");
  });

  it("rejects in-progress status finish messages while tools are available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: "Please hold while I inspect the current files and confirm the remaining work."
        }
      },
      { name: "run", arguments: { command: "printf inspected" } },
      { name: "finish", arguments: { message: "Inspected and found no changes were needed." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-in-progress-finish-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect and report"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Inspected");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Finish rejected: the message is an in-progress status update");
    expect(userMessages(provider.requests[2].body)).toContain("inspected");
  });

  it("rejects first-person rechecking finish messages while tools are available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: "I'm rechecking the current state and validation so I can either finish cleanly or report a precise blocker."
        }
      },
      { name: "finish", arguments: { message: "Blocked: validation is still failing with a compile error." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-rechecking-finish-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect and report"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Blocked: validation is still failing");
    expect(provider.requests).toHaveLength(2);
    expect(userMessages(provider.requests[1].body)).toContain("Finish rejected: the message is an in-progress status update");
  });

  it("rejects first-person rechecking finish messages when only finish is available", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "sleep 0.02; printf inspected" } },
      {
        name: "finish",
        arguments: {
          message: "I'm rechecking the current state and validation so I can either finish cleanly or report a precise blocker."
        }
      },
      { name: "finish", arguments: { message: "Blocked: the run budget elapsed before validation could complete." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-rechecking-finish-only-"));
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
read_only = true
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect and report"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Blocked: the run budget elapsed");
    expect(provider.requests).toHaveLength(3);
    expect(toolNames(provider.requests[1].body)).toEqual(["finish"]);
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: the message is an in-progress status update");
  });

  it("warns when a patch removes declarations that may need compatibility wrappers", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: parser.go",
            "@@",
            "-func parseLegacyLine(input string) string {",
            "+func parseLine(input string) string {",
            " \treturn input",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-compat-declaration-patch-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "parser.go"), "func parseLegacyLine(input string) string {\n\treturn input\n}\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "rename parser"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patched");
    expect(messages(provider.requests[1].body)[4].content).toContain("Compatibility note");
    expect(messages(provider.requests[1].body)[4].content).toContain("`parseLegacyLine`");
    expect(messages(provider.requests[1].body)[4].content).not.toContain("`parseLine`");
  });

  it("warns when a patch changes declaration signatures that may break callers", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: parser.go",
            "@@",
            "-func parseLine(input string) (string, error) {",
            "+func parseLine(input string) (string, bool, error) {",
            "-\treturn input, nil",
            "+\treturn input, true, nil",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-compat-signature-patch-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "parser.go"), "func parseLine(input string) (string, error) {\n\treturn input, nil\n}\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "change parser"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patched");
    expect(messages(provider.requests[1].body)[4].content).toContain("changes declaration signatures");
    expect(messages(provider.requests[1].body)[4].content).toContain("`parseLine`");
    expect(messages(provider.requests[1].body)[4].content).toContain("keep wrappers or adapters");
  });

  it("rejects completion claims that ignore declaration compatibility requirements", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: parser.go",
            "@@",
            "-func parseLine(input string) (string, error) {",
            "+func parseLine(input string) (string, bool, error) {",
            "-\treturn input, nil",
            "+\treturn input, true, nil",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "Done. npm test passed. No blockers remain." } },
      {
        name: "finish",
        arguments: {
          message:
            "Done. npm test passed, and declaration compatibility was checked: existing callers and old signature compatibility are preserved."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-compat-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "parser.go"), "func parseLine(input string) (string, error) {\n\treturn input, nil\n}\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
    writeFileSync(join(cwd, "test.js"), "console.log('checked');\n", "utf8");
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

    const prompt = "Update parser.go. Requirements: preserve compatibility with existing callers and keep the API stable.";
    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, prompt], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("old signature compatibility are preserved");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[1].body)).toContain("changes declaration signatures");
    expect(userMessages(provider.requests[3].body)).toContain(
      "Finish rejected: the prompt asks to preserve interface/API compatibility"
    );
  });

  it("warns when a patch changes struct fields that may break keyed callers", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: forwarder.go",
            "@@",
            " type Forwarder struct {",
            "-\tForwarderConfig",
            "+\tcfg ForwarderConfig",
            " \tlog Logger",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-compat-struct-fields-patch-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "forwarder.go"), "type Forwarder struct {\n\tForwarderConfig\n\tlog Logger\n}\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "change forwarder"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patched");
    expect(messages(provider.requests[1].body)[4].content).toContain("changes struct or object fields");
    expect(messages(provider.requests[1].body)[4].content).toContain("`ForwarderConfig`");
    expect(messages(provider.requests[1].body)[4].content).toContain("keyed struct literals");
    expect(messages(provider.requests[1].body)[4].content).toContain("embedded-field callers");
  });

  it("does not warn when a patch only changes local variables", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: forwarder.go",
            "@@",
            " func build() error {",
            "-\tr := run()",
            "+\tresult := run()",
            "-\tlistCmd := command()",
            "+\tindexRes := command()",
            " \treturn nil",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched; validation pending" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-compat-local-vars-patch-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "forwarder.go"), "func build() error {\n\tr := run()\n\tlistCmd := command()\n\treturn nil\n}\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "change locals"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patched");
    expect(messages(provider.requests[1].body)[4].content).not.toContain("changes struct or object fields");
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

  it("rejects inspection-path blockers when post-deadline inspection is available", async () => {
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
      {
        name: "finish",
        arguments: {
          message: [
            "Blocker: I cannot safely complete the requested fix from the current tool state.",
            "",
            "Why this is blocked:",
            "- The file context no longer matched the recorded snippets.",
            "- The remaining work requires exact current-line inspection before any further edits.",
            "- In the current post-deadline mode, I do not have a reliable inspection path left."
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "sed -n '1,2p' note.txt", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "blocked after inspection" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-post-deadline-inspection-blocker-"));
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
    expect(provider.requests).toHaveLength(4);
    expect(toolNames(provider.requests[2].body)).toEqual(["run", "patch", "finish"]);
    expect(userMessages(provider.requests[2].body)).toContain(
      "Finish rejected: run is currently available, and the finish message says more inspection or diagnosis is needed"
    );
    expect(userMessages(provider.requests[3].body)).toContain("old");
  });

  it("rejects provider-history patch placeholders with actionable recovery guidance", async () => {
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
        name: "patch",
        arguments: {
          patch:
            "[smith omitted previous patch body from provider history; this placeholder is not a valid patch. Write a fresh Smith patch that starts with *** Begin Patch.]"
        }
      },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-new",
            "+final",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "patched with a fresh patch; validation is pending." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-patch-placeholder-"));
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

    expect(stdout).toContain("patched with a fresh patch");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("final\n");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("reused a previous-patch placeholder");
    expect(userMessages(provider.requests[2].body)).toContain("Reconstruct a fresh Smith patch");
  });

  it("keeps post-deadline inspection available after inspection has been paused", async () => {
    const provider = await startFakeProvider([
      ...Array.from({ length: 36 }, (_, index) => ({
        name: "run" as const,
        arguments: { command: `printf output-${index}` }
      })),
      {
        name: "patch",
        delayMs: 3500,
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
      { name: "run", arguments: { command: "sed -n '1p' note.txt", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "blocked after inspection" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-paused-post-deadline-inspection-"));
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
max_run_ms = 3000
max_turns = 50
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch note"], {
      env: { ...process.env, HOME: home },
      timeout: 15_000
    });

    expect(stdout).toContain("blocked after inspection");
    expect(toolNames(provider.requests[36].body)).toEqual(["patch", "finish"]);
    expect(systemMessage(provider.requests[36].body)).toContain(
      "Sustained inspection has continued without a task patch or finish"
    );
    expect(toolNames(provider.requests[37].body)).toEqual(["run", "patch", "finish"]);
    expect(systemMessage(provider.requests[37].body)).toContain("post-deadline patch failed because its context did not match");
    expect(systemMessage(provider.requests[37].body)).toContain("Continue with available tools: run, patch, finish");
    expect(userMessages(provider.requests[38].body)).toContain("old");
    expect(userMessages(provider.requests[38].body)).not.toContain("Unknown or unavailable tool 'run'");
  }, 12_000);

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

  it("reports sub_agent edits as pending parent validation", async () => {
    const provider = await startFakeProvider([
      { name: "sub_agent", arguments: { task: "update the test fixture" } },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: tests/example.test.js",
            "@@",
            "-old",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "finish", arguments: { message: "child changed the fixture; validation pending" } },
      { name: "finish", arguments: { message: "Blocked: no files were changed." } },
      { name: "finish", arguments: { message: "Blocked: tests/example.test.js changed and validation is pending." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-sub-agent-edit-tracking-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "tests", "example.test.js"), "old\n", "utf8");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });
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
max_turns = 20
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "parent task"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(provider.requests).toHaveLength(5);
    expect(stdout).toContain("Blocked: tests/example.test.js changed");
    expect(readFileSync(join(cwd, "tests", "example.test.js"), "utf8")).toBe("new\n");
    expect(userMessages(provider.requests[3].body)).toContain("Sub-agent changed tracked files: tests/example.test.js");
    expect(userMessages(provider.requests[3].body)).toContain("Task patch pending validation");
    expect(userMessages(provider.requests[4].body)).toContain("Finish rejected: test files are currently modified or untracked");
    expect(userMessages(provider.requests[4].body)).toContain("no files or code changed");
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
    expect(replayedOutput).toContain("rerun a narrower command if needed");
    expect(replayedOutput).toContain("omitted");
    expect(replayedOutput.length).toBeLessThan(330);
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
    expect(replayedOutput).toContain("rerun a narrower command if needed");
    expect(replayedOutput).toContain("omitted");
    expect(replayedOutput.length).toBeLessThan(330);
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

  it("allows one short inspection after a paused-inspection patch context mismatch", async () => {
    const provider = await startFakeProvider([
      ...Array.from({ length: 36 }, (_, index) => ({
        name: "run" as const,
        arguments: { command: `printf output-${index}` }
      })),
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-stale",
            "+new",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "sed -n '1,20p' note.txt" } },
      { name: "finish", arguments: { message: "blocked after exact-line inspection" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-paused-context-inspection-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "current\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "inspect then patch"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("blocked after exact-line inspection");
    expect(provider.requests).toHaveLength(39);
    expect(toolNames(provider.requests[36].body)).toEqual(["patch", "finish"]);
    expect(systemMessage(provider.requests[37].body)).toContain(
      "A patch failed because its context did not match after inspection was paused"
    );
    expect(toolNames(provider.requests[37].body)).toContain("run");
    expect(userMessages(provider.requests[38].body)).toContain("current");
    expect(toolNames(provider.requests[38].body)).toEqual(["patch", "finish"]);
  });

  it("keeps run available after sustained inspection when a task patch needs validation", async () => {
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
      ...Array.from({ length: 36 }, (_, index) => ({
        name: "run" as const,
        arguments: { command: `printf inspect-${index}` }
      })),
      { name: "finish", arguments: { message: "Changed note.txt; validation is pending after inspection." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-pending-validation-inspection-"));
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
max_turns = 45
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch then inspect"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation is pending");
    expect(provider.requests).toHaveLength(38);
    expect(toolNames(provider.requests[37].body)).toContain("run");
    expect(userMessages(provider.requests[37].body)).toContain("Smith progress: 36 tool calls have completed");
    expect(userMessages(provider.requests[37].body)).toContain("available tools: run, patch");
    expect(systemMessage(provider.requests[37].body)).not.toContain(
      "Sustained inspection has continued without a task patch or finish"
    );
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

  it("allows one short inspection after a post-deadline compatibility-warning patch", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "sleep 0.02; printf ready" } },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.js",
            "@@",
            "-function greet(name) {",
            "+function greet(name, suffix = \"\") {",
            "-  return `hi ${name}`;",
            "+  return `hi ${name}${suffix}`;",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "grep -n \"function greet\" note.js", timeout_ms: 5000 } },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-post-deadline-compat-inspection-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, "note.js"),
      ["function greet(name) {", "  return `hi ${name}`;", "}", "", "module.exports = { greet };", ""].join("\n"),
      "utf8"
    );
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node -e \"require('./note').greet('a')\"" } }), "utf8");
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
    expect(systemMessage(provider.requests[2].body)).toContain("post-deadline task patch changed declarations");
    expect(userMessages(provider.requests[3].body)).toContain("function greet");
    expect(userMessages(provider.requests[3].body)).not.toContain("Post-deadline run is reserved");
    expect(userMessages(provider.requests[4].body)).toContain("exit_status: 0");
    expect(readFileSync(join(cwd, "note.js"), "utf8")).toContain("function greet(name, suffix = \"\")");
  });

  it("allows one short inspection after a post-deadline read-only test patch failure", async () => {
    const provider = await startFakeProvider([
      { name: "run", arguments: { command: "sleep 0.02; printf output" } },
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
      { name: "run", arguments: { command: "sed -n '1p' src/app.js" } },
      { name: "finish", arguments: { message: "blocked after source compatibility inspection" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-post-deadline-readonly-test-inspection-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.js"), "old-source\n", "utf8");
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source compatibility"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("blocked after source compatibility inspection");
    expect(provider.requests).toHaveLength(4);
    expect(toolNames(provider.requests[1].body)).toEqual(["patch", "finish"]);
    expect(systemMessage(provider.requests[2].body)).toContain("post-deadline read-only test/spec patch failed");
    expect(userMessages(provider.requests[3].body)).toContain("old-source");
    expect(userMessages(provider.requests[3].body)).not.toContain("Post-deadline run is reserved");
  });

  it("does not classify printf-labeled inspection pipelines as validation", async () => {
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
        name: "run",
        arguments: {
          command: "grep -n old tests/note.test.js | head -1 && printf '%s\\n' '--- test harness ---' && sed -n '1p' tests/note.test.js",
          timeout_ms: 5000
        }
      },
      { name: "finish", arguments: { message: "done" } },
      { name: "finish", arguments: { message: "Changed note.txt; validation pending after inspection only." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-printf-inspection-pipeline-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "tests", "note.test.js"), "old test\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and inspect"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("--- test harness ---");
    expect(userMessages(provider.requests[2].body)).not.toContain("Validation warning");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: a task patch is still pending validation");
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

  it("allows a read-only Python inspection after a failed post-deadline validation command", async () => {
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
      {
        name: "run",
        arguments: {
          command: "python - <<'PY'\nfrom pathlib import Path\nprint(Path('note.txt').read_text())\nPY",
          timeout_ms: 5000
        }
      },
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

    const cwd = mkdtempSync(join(tmpdir(), "smith-failed-post-deadline-python-inspection-"));
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
    expect(userMessages(provider.requests[3].body)).not.toContain("Post-deadline run is reserved");
    expect(userMessages(provider.requests[5].body)).toContain("checked");
  });

  it("rejects validation success claims while a task patch remains unvalidated", async () => {
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
      { name: "run", arguments: { command: "sleep 0.02; node test.js", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "Changed note.txt and validation passed with node test.js." } },
      {
        name: "finish",
        arguments: {
          message:
            "Changed note.txt; validation remains pending after only a narrow test file check because broader validation is not practical after run became unavailable."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-unvalidated-deadline-claim-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "test.js"), "console.log('checked');\n", "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation remains pending");
    expect(provider.requests).toHaveLength(4);
    expect(toolNames(provider.requests[2].body)).toEqual(["run", "patch", "finish"]);
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command selected a subset of checks");
    expect(userMessages(provider.requests[3].body)).toContain(
      "Finish rejected: a task patch is still not validated as complete"
    );
  });

  it("rejects local validation success claims when only external validation is pending", async () => {
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
      {
        name: "finish",
        arguments: {
          message: [
            "Blocker / pending validation report",
            "",
            "Implemented locally:",
            "- Relevant local package tests passed: `npm test -- --grep selected`.",
            "",
            "Still pending external validation:",
            "- A live smoke test against the deployed service.",
            "",
            "I am reporting the implementation as locally validated but not fully end-to-end verified."
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message:
            "Changed note.txt; patch validation remains pending after only a narrow selected test check because broader project validation is not practical here."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-external-only-pending-validation-"));
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
max_run_ms = 1
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("patch validation remains pending");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: this command selected a subset of checks");
    expect(userMessages(provider.requests[3].body)).toContain(
      "Finish rejected: a task patch is still not validated as complete"
    );
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

  it("adds source compatibility guidance for missing declarations in failed validation", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/parser.ts",
            "@@",
            "-export const value = 1;",
            "+export const value = 2;",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "run",
        arguments: {
          command: "test -e definitely-missing || (printf 'src/parser.test.ts:10: parser.parseLegacy does not exist\\n' >&2; exit 1)",
          timeout_ms: 5000
        }
      },
      { name: "finish", arguments: { message: "blocked" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-missing-declaration-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "parser.ts"), "export const value = 1;\n", "utf8");
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
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
    expect(userMessages(provider.requests[2].body)).toContain(
      "Compatibility hint: validation reports missing declarations, fields, methods, or symbols after source changes"
    );
  });

  it("adds source compatibility guidance for missing fields in failed validation", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/forwarder.go",
            "@@",
            " type Forwarder struct {",
            "-\tcfg Config",
            "+\tConfig Config",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "run",
        arguments: {
          command: "test -e definitely-missing || (printf \"src/forwarder_test.go:47:3: unknown field 'cfg' in struct literal of type Forwarder\\nsrc/forwarder_test.go:57:5: f.cfg undefined (type *Forwarder has no field or method cfg)\\n\" >&2; exit 1)",
          timeout_ms: 5000
        }
      },
      { name: "finish", arguments: { message: "blocked" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-missing-field-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "forwarder.go"), "type Config struct{}\ntype Forwarder struct {\n\tcfg Config\n}\n", "utf8");
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
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
    expect(userMessages(provider.requests[2].body)).toContain(
      "Compatibility hint: validation reports unknown or missing fields after source changes"
    );
    expect(userMessages(provider.requests[2].body)).toContain("restore legacy fields/accessors");
  });

  it("adds source compatibility guidance for signature mismatches in failed validation", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/parser.go",
            "@@",
            "-func parseLine(input string) (string, error) {",
            "+func parseLine(input string) (string, bool, error) {",
            "-\treturn input, nil",
            "+\treturn input, true, nil",
            " }",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "run",
        arguments: {
          command:
            "test -e definitely-missing || (printf 'src/parser.go:12:14: assignment mismatch: 2 variables but parseLine returns 3 values\\n' >&2; exit 1)",
          timeout_ms: 5000
        }
      },
      { name: "finish", arguments: { message: "blocked" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-signature-mismatch-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "parser.go"), "func parseLine(input string) (string, error) {\n\treturn input, nil\n}\n", "utf8");
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
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
    expect(userMessages(provider.requests[2].body)).toContain(
      "Compatibility hint: validation reports argument, assignment, or return-value mismatches after source changes"
    );
    expect(userMessages(provider.requests[2].body)).toContain("small source compatibility fix");
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

  it("uses a timeout floor for validation commands after patches", async () => {
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
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 10 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-validation-timeout-floor-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "test.js"),
      "setTimeout(() => { process.stdout.write('checked'); }, 50);\n",
      "utf8"
    );
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
timeout_ms = 3000
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("done");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\n");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain("checked");
    expect(userMessages(provider.requests[2].body)).not.toContain("Command timed out");
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

  it("matches absolute changed go file paths against relative go test packages", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-go-absolute-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    const bin = join(cwd, "bin");
    const modelPath = join(cwd, "models", "thing.go");
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "models"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(modelPath, "package models\n", "utf8");
    writeFileSync(join(bin, "go"), "#!/bin/sh\necho 'ok  \texample.test/models\t0.001s'\n", "utf8");
    chmodSync(join(bin, "go"), 0o755);

    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            `*** Update File: ${modelPath}`,
            "@@",
            "-package models",
            "+package models",
            "+",
            "+func Thing() string { return \"thing\" }",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "go test -count=1 ./models", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } }
    ]);
    servers.push(provider.server);

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
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain("ok  \texample.test/models");
    expect(userMessages(provider.requests[2].body)).not.toContain(
      "Validation warning: this command did not appear to cover all changed source directories"
    );
  });

  it("keeps validation pending when source validation runs with modified or untracked test files", async () => {
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
            "*** Add File: tests/new.test.js",
            "+console.log('new test');",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } },
      { name: "finish", arguments: { message: "Changed note.txt; validation pending because tests are modified." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-dirty-test-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node tests/new.test.js" } }), "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation pending");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[1].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("new test");
    expect(userMessages(provider.requests[2].body)).toContain("Validation warning: test files are currently modified or untracked");
    expect(userMessages(provider.requests[2].body)).toContain("tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("a source patch is still pending validation");
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: test files are currently modified or untracked");
    expect(userMessages(provider.requests[3].body)).toContain("tests/new.test.js");
  });

  it("keeps validation pending when only unrequested test files are modified", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Add File: tests/new.test.js",
            "+console.log('new test');",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "done" } },
      { name: "finish", arguments: { message: "Validation pending because tests are modified." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-unrequested-test-validation-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node tests/new.test.js" } }), "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source behavior"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Validation pending");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[1].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("new test");
    expect(userMessages(provider.requests[2].body)).toContain(
      "a task patch is still pending validation because this passing command ran while test files were modified"
    );
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: test files are currently modified or untracked");
    expect(userMessages(provider.requests[3].body)).toContain("tests/new.test.js");
  });

  it("rejects completion finishes while unrequested test files are dirty", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Add File: tests/new.test.js",
            "+console.log('new test');",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Implemented and verified the source fix with the existing test suite."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Validation pending because tests are modified."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-dirty-test-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
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
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source behavior"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Validation pending");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: test files are currently modified or untracked");
    expect(userMessages(provider.requests[2].body)).toContain("tests/new.test.js");
  });

  it("rejects validation-success partial finishes while unrequested test files are dirty", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Add File: tests/new.test.js",
            "+console.log('new test');",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message:
            "Partial blocker report: source work is incomplete, but validation passed with npm test. Blocked on remaining refactor work."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Partial blocker report: validation is pending because tests/new.test.js is modified."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-dirty-test-validation-success-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
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
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source behavior"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation is pending");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: test files are currently modified or untracked");
    expect(userMessages(provider.requests[2].body)).toContain("claims validation success");
    expect(userMessages(provider.requests[2].body)).toContain("tests/new.test.js");
  });

  it("requires validation caveats when requested test files are dirty", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Add File: tests/new.test.js",
            "+console.log('new test');",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      {
        name: "finish",
        arguments: {
          message: "Implemented the source and tests. Validation passed with npm test."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Implemented the source and tests. Validation passed with npm test. Caveat: test files changed during validation."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-dirty-requested-test-validation-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
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

    const { stdout } = await execFileAsync(
      "node",
      [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source behavior and add tests"],
      {
        env: { ...process.env, HOME: home },
        timeout: 10_000
      }
    );

    expect(stdout).toContain("test files changed during validation");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[1].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[3].body)).toContain("claims validation success without acknowledging");
    expect(userMessages(provider.requests[3].body)).toContain("tests/new.test.js");
  });

  it("rejects no-changed-files finishes while requested test files are dirty", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Add File: tests/new.test.js",
            "+console.log('new test');",
            "*** End Patch"
          ].join("\n")
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Blocked before completing the source fix. No files were changed."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Blocked before completing the source fix; tests/new.test.js is changed and validation is pending."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-requested-test-no-files-finish-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
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
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "update tests and source"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("tests/new.test.js is changed");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Test files changed: tests/new.test.js");
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: test files are currently modified or untracked");
    expect(userMessages(provider.requests[2].body)).toContain("no files or code changed");
    expect(userMessages(provider.requests[2].body)).toContain("tests/new.test.js");
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

  it("allows unvalidated patch blockers when verification could not complete", async () => {
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
          message:
            "Blocker report: the requested source changes are patched, but they could not be verified because I cannot complete validation in this environment."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-unvalidated-finish-unverified-"));
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

    expect(stdout).toContain("could not be verified");
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

  it("rejects runtime-limit validation blockers when run is available", async () => {
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
          message: [
            "# Checklist status",
            "",
            "- [done] Source change is in place.",
            "- [blocked] I could not finish post-edit validation under the current tool/runtime limits.",
            "- [not run] No test/build verification was completed in this run."
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "validated" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-runtime-limit-validation-blocker-"));
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validated");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: run is currently available");
    expect(userMessages(provider.requests[3].body)).toContain("checked");
  });

  it("rejects post-deadline run-rejected validation blockers when validation run is available", async () => {
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
          message:
            "Blocker report: I could not validate the patch because subsequent run commands were rejected after the deadline threshold."
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "validated" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-run-rejected-validation-blocker-"));
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch and validate"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validated");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: run is currently available");
    expect(userMessages(provider.requests[3].body)).toContain("checked");
  });

  it("rejects session-scoped validation execution blockers when run is available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: "Blocked: I cannot run the required build/tests in this session to verify the patch."
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "validated" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-session-validation-blocker-"));
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

  it("rejects combined inspection-validation unavailable finish claims when run is available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message:
            "Blocked: I could not run a post-change validation because no inspection/validation tool is available now."
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "validated" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-inspection-validation-unavailable-finish-"));
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

  it("rejects unavailable tool-access finish claims when run is available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message:
            "Blocked: tool access for the inspection/validation steps needed to safely complete and verify the change is no longer available."
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "validated" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-tool-access-unavailable-finish-"));
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

  it("rejects actionable inspection blockers when run is available", async () => {
    const provider = await startFakeProvider([
      {
        name: "finish",
        arguments: {
          message: "I am blocked on a build failure and need to inspect the failing file before I can safely finish."
        }
      },
      { name: "run", arguments: { command: "printf inspected", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "inspected and reported" } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-actionable-inspection-finish-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "diagnose build"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("inspected and reported");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[1].body)).toContain("Finish rejected: run is currently available");
    expect(userMessages(provider.requests[2].body)).toContain("inspected");
  });

  it("rejects local service validation blockers before setup recovery is attempted", async () => {
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
        name: "run",
        arguments: {
          command: "node -e \"console.error('Error: connect ECONNREFUSED 127.0.0.1:6379'); process.exit(1)\""
        }
      },
      {
        name: "finish",
        arguments: {
          message:
            "Blocker report: validation could not run because the test harness cannot connect to Redis (`ECONNREFUSED 127.0.0.1:6379`)."
        }
      },
      { name: "run", arguments: { command: "npm test --silent", timeout_ms: 5000 } },
      { name: "finish", arguments: { message: "Implemented and validated with the service-aware test harness." } }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-local-service-validation-blocker-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "old\n", "utf8");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "printf service-aware-validation" } }), "utf8");
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "Requirements:\n- Change note.txt and validate it."], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Implemented and validated");
    expect(provider.requests).toHaveLength(5);
    expect(userMessages(provider.requests[3].body)).toContain("Finish rejected: validation failed because a local service or database connection was refused");
    expect(userMessages(provider.requests[4].body)).toContain("service-aware-validation");
  });

  it("allows inspection blockers when the post-deadline run slot only accepts validation", async () => {
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
          message:
            "Blocked: validation remains pending, but I need to inspect the syntax error before I can safely repair it."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-validation-slot-inspection-blocker-"));
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
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "patch near deadline"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("validation remains pending");
    expect(provider.requests).toHaveLength(2);
    expect(systemMessage(provider.requests[1].body)).toContain("one bounded validation command");
    expect(userMessages(provider.requests[1].body)).not.toContain("Finish rejected: run is currently available");
  });

  it("allows honest partial explicit-requirement finishes after post-deadline run is unavailable", async () => {
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
      {
        name: "finish",
        arguments: {
          message:
            "Partial result: the source patch is in place, but validation remains pending because the post-deadline validation run failed and no run tool remains available."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-post-deadline-partial-explicit-"));
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
max_run_ms = 1
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "Change note.txt and validate it."], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Partial result");
    expect(stdout).toContain("validation remains pending");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain("Validation failed: any pending task patch is not validated");
    expect(userMessages(provider.requests[2].body)).not.toContain("Finish rejected: the prompt has explicit requirements");
  });

  it("rejects optional continuation finishes when a source implementation path remains", async () => {
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
          message:
            "Blocked/incomplete items:\n- Existing caller compatibility is still missing.\n\nIf you want, I can continue by adding compatibility wrappers for the existing callers."
        }
      },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: note.txt",
            "@@",
            "-new",
            "+new",
            "+compat",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test --silent" } },
      {
        name: "finish",
        arguments: {
          message: "Implemented and validated the requested compatibility update."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-deferred-source-path-"));
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
max_turns = 30
`,
      "utf8"
    );

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "Requirements:\n- Change note.txt.\n- Preserve compatibility."], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Implemented and validated");
    expect(readFileSync(join(cwd, "note.txt"), "utf8")).toBe("new\ncompat\n");
    expect(provider.requests).toHaveLength(5);
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: patch is available and the finish message says an implementation path remains");
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
    expect(userMessages(provider.requests[1].body)).toContain(
      "If the failed test/spec edit referenced expected source APIs, helper names, fields, or behaviors"
    );
    expect(userMessages(provider.requests[2].body)).toContain("Finish rejected: a read-only test/spec patch failed");
  });

  it("rejects completed finish claims that omit an earlier read-only test patch failure", async () => {
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
          message: "Implemented and verified the source fix with the existing test suite."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Partial result: the source fix still needs compatibility work against existing tests."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-hidden-readonly-test-finish-"));
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

  it("rejects read-only test blockers when the user did not ask to edit tests", async () => {
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
          message: "Partial blocker: tests/readonly.test.js is read-only, so validation coverage is blocked."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Partial blocker: source compatibility still needs work."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-readonly-test-blocker-"));
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source compatibility"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("source compatibility still needs work");
    expect(provider.requests).toHaveLength(3);
    expect(userMessages(provider.requests[2].body)).toContain(
      "Finish rejected: a read-only test/spec patch failed, but the user did not explicitly ask to edit tests"
    );
  });

  it("allows completion after a source patch validates a prior read-only test patch failure", async () => {
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
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/app.js",
            "@@",
            "-module.exports = () => 'old';",
            "+module.exports = () => 'new';",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test --silent" } },
      {
        name: "finish",
        arguments: {
          message: "Implemented and validated the source fix with the existing test suite."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-readonly-test-cleared-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.js"), "module.exports = () => 'old';\n", "utf8");
    writeFileSync(join(cwd, "tests", "readonly.test.js"), "old\n", "utf8");
    chmodSync(join(cwd, "tests", "readonly.test.js"), 0o444);
    writeFileSync(
      join(cwd, "test.js"),
      "if (require('./src/app')() !== 'new') process.exit(1);\nprocess.stdout.write('validated');\n",
      "utf8"
    );
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source compatibility"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Implemented and validated");
    expect(readFileSync(join(cwd, "src", "app.js"), "utf8")).toBe("module.exports = () => 'new';\n");
    expect(provider.requests).toHaveLength(4);
    expect(userMessages(provider.requests[1].body)).toContain("The unwritable path appears to be a test or spec file");
    expect(userMessages(provider.requests[3].body)).toContain("validated");
    expect(userMessages(provider.requests[3].body)).not.toContain("Finish rejected: a read-only test/spec patch failed");
  });

  it("requires source compatibility work after a read-only test patch failure", async () => {
    const provider = await startFakeProvider([
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/app.js",
            "@@",
            "-module.exports = () => 'old';",
            "+module.exports = () => 'new';",
            "*** End Patch"
          ].join("\n")
        }
      },
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
      { name: "run", arguments: { command: "npm test --silent" } },
      {
        name: "finish",
        arguments: {
          message: "Implemented and validated the source fix with the existing test suite."
        }
      },
      {
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/app.js",
            "@@",
            "-module.exports = () => 'new';",
            "+module.exports = () => 'new';",
            "+module.exports.compat = true;",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test --silent" } },
      {
        name: "finish",
        arguments: {
          message: "Implemented and validated the source fix with the existing test suite."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-readonly-test-source-after-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.js"), "module.exports = () => 'old';\n", "utf8");
    writeFileSync(join(cwd, "tests", "readonly.test.js"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "test.js"),
      "if (require('./src/app')() !== 'new') process.exit(1);\nprocess.stdout.write('validated');\n",
      "utf8"
    );
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source compatibility"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("Implemented and validated");
    expect(userMessages(provider.requests[2].body)).toContain("The unwritable path appears to be a test or spec file");
    expect(userMessages(provider.requests[2].body)).toContain(
      "preserve or add the corresponding source declarations or compatibility wrappers"
    );
    expect(provider.requests).toHaveLength(7);
    expect(readFileSync(join(cwd, "src", "app.js"), "utf8")).toBe(
      "module.exports = () => 'new';\nmodule.exports.compat = true;\n"
    );
    expect(userMessages(provider.requests[3].body)).toContain("validated");
    expect(userMessages(provider.requests[4].body)).toContain("Finish rejected: a read-only test/spec patch failed");
    expect(userMessages(provider.requests[6].body)).toContain("validated");
  });

  it("lets pending-validation guard handle narrow validation after a read-only test patch failure", async () => {
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
        name: "patch",
        arguments: {
          patch: [
            "*** Begin Patch",
            "*** Update File: src/app.js",
            "@@",
            "-module.exports = () => 'old';",
            "+module.exports = () => 'new';",
            "*** End Patch"
          ].join("\n")
        }
      },
      { name: "run", arguments: { command: "npm test --silent -- --grep source" } },
      {
        name: "finish",
        arguments: {
          message: "Implemented and validated the source fix with the selected tests."
        }
      },
      {
        name: "finish",
        arguments: {
          message: "Partial result: the source fix is in place, but broader validation remains pending."
        }
      }
    ]);
    servers.push(provider.server);

    const cwd = mkdtempSync(join(tmpdir(), "smith-readonly-test-narrow-"));
    const home = mkdtempSync(join(tmpdir(), "smith-home-"));
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "tests"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.js"), "module.exports = () => 'old';\n", "utf8");
    writeFileSync(join(cwd, "tests", "readonly.test.js"), "old\n", "utf8");
    writeFileSync(
      join(cwd, "test.js"),
      "if (require('./src/app')() !== 'new') process.exit(1);\nprocess.stdout.write('selected validation');\n",
      "utf8"
    );
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }), "utf8");
    await execFileAsync("git", ["init"], { cwd });
    await execFileAsync("git", ["add", "."], { cwd });
    await execFileAsync("git", ["-c", "user.name=Smith Test", "-c", "user.email=smith@example.test", "commit", "-m", "init"], {
      cwd
    });
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

    const { stdout } = await execFileAsync("node", [join(process.cwd(), "bin/smith.js"), "--cwd", cwd, "fix source compatibility"], {
      env: { ...process.env, HOME: home },
      timeout: 10_000
    });

    expect(stdout).toContain("broader validation remains pending");
    expect(provider.requests).toHaveLength(5);
    expect(userMessages(provider.requests[4].body)).toContain("selected validation");
    expect(userMessages(provider.requests[4].body)).toContain("Finish rejected: a task patch is still not validated as complete");
    expect(userMessages(provider.requests[4].body)).not.toContain("Finish rejected: a read-only test/spec patch failed");
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
  delayMs?: number;
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
      const sendResponse = () => {
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
      };
      if (toolCall.delayMs && toolCall.delayMs > 0) {
        setTimeout(sendResponse, toolCall.delayMs);
      } else {
        sendResponse();
      }
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
