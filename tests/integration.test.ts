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

  it("runs against a fake OpenAI-chat provider and stops on chat_out", async () => {
    const provider = await startFakeProvider(["cat README.md", "chat_out \"Read $(cat README.md)\""]);
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
    expect(systemMessage(provider.requests[0].body)).not.toContain("Task memory from SMITH.TASK.md");
    expect(userMessage(provider.requests[0].body)).toContain("inspect README");
    expect(userMessage(provider.requests[0].body)).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(existsSync(join(cwd, "SMITH.TASK.md"))).toBe(false);
  });

  it("records transcript compaction without refreshing the system prompt", async () => {
    const provider = await startFakeProvider([
      "printf first",
      "printf '%s\\n' 'Updated task fact' > SMITH.TASK.md",
      "chat_out \"done\""
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

  it("remote prints only first chat_out to stdout and supports resume", async () => {
    const provider = await startFakeProvider(["chat_out \"need info\"", "chat_out \"resumed\""]);
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
    expect(userMessage(provider.requests[0].body)).toContain("Local SMITH.TASK.md exists");
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
    const provider = await startFakeProvider(["printf hidden", "chat_out \"visible\""]);
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

async function startFakeProvider(commands: string[]): Promise<{
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
      const command = commands[Math.min(count, commands.length - 1)];
      count += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: command } }] }));
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

function userMessage(body: unknown): string {
  const messages = (body as { messages?: Array<{ role?: string; content?: string }> }).messages ?? [];
  return messages.find((message) => message.role === "user")?.content ?? "";
}
