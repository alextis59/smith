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

  it("applies patch tool calls through smith_patch", async () => {
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
transcript_turns = 1
transcript_compaction_min_chars = 0
transcript_compaction_hysteresis_turns = 0
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

async function startFakeProvider(toolCalls: FakeToolCall[]): Promise<{
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
          ]
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
