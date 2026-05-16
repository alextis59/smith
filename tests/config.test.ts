import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultConfigToml,
  initConfig,
  loadConfig,
  parseCliConfigOverrides,
  resolveApiKey,
  resolveProfile,
  userConfigPath
} from "../src/config.js";

describe("config loading", () => {
  it("loads built-in defaults", () => {
    const config = loadConfig({ homeDir: tempDir(), cwd: tempDir() });
    expect(config.defaultProfile).toBe("default");
    expect(resolveProfile(config).adapter).toBe("openai-chat");
    expect(config.runtime.dangerReview).toBe("llm");
    expect(config.runtime.dangerReviewProfile).toBe("reviewer");
  });

  it("merges user config, project config, and CLI overrides in order", () => {
    const home = tempDir();
    const cwd = tempDir();
    mkdirSync(join(home, ".smith"), { recursive: true });
    mkdirSync(join(cwd, ".smith"), { recursive: true });

    writeFileSync(
      userConfigPath(home),
      `default_profile = "fast"

[profiles.fast]
adapter = "openai-chat"
base_url = "https://user.example/v1"
api_key_env = "USER_KEY"
model = "user-model"
temperature = 0.4

[runtime]
timeout_ms = 10
`,
      "utf8"
    );
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[profiles.fast]
base_url = "https://project.example/v1"
model = "project-model"
stop = ["DONE"]

[profiles.fast.headers]
X-Test = "project"

[profiles.fast.body]
provider = { sort = "throughput" }

[runtime]
timeout_ms = 20
`,
      "utf8"
    );

    const config = loadConfig({
      homeDir: home,
      cwd,
      cli: { model: "cli-model", temperature: 0.1, timeoutMs: 30 }
    });
    const profile = resolveProfile(config);

    expect(profile.baseUrl).toBe("https://project.example/v1");
    expect(profile.apiKeyEnv).toBe("USER_KEY");
    expect(profile.model).toBe("cli-model");
    expect(profile.temperature).toBe(0.1);
    expect(profile.stop).toEqual(["DONE"]);
    expect(profile.headers["X-Test"]).toBe("project");
    expect(profile.body).toEqual({ provider: { sort: "throughput" } });
    expect(config.runtime.timeoutMs).toBe(30);
    expect(config.files).toHaveLength(2);
  });

  it("resolves API keys from configured environment variable names", () => {
    const config = loadConfig({ homeDir: tempDir(), cwd: tempDir() });
    expect(resolveApiKey(resolveProfile(config), { OPENAI_API_KEY: "secret" })).toBe("secret");
  });

  it("parses CLI config overrides", () => {
    const parsed = parseCliConfigOverrides([
      "--profile=fast",
      "--cwd",
      "/repo",
      "--adapter",
      "gemini",
      "--base-url",
      "https://gateway",
      "--api-key-env",
      "GATEWAY_KEY",
      "--model",
      "gemini-test",
      "--temperature",
      "0",
      "--max-output-tokens",
      "64",
      "--reasoning-effort",
      "low",
      "--stop",
      "STOP",
      "--input-cost-per-million-tokens",
      "1.25",
      "--output-cost-per-million-tokens=10",
      "--max-turns",
      "7",
      "--transcript-compaction-chars=500",
      "--read-only",
      "--provider-retries",
      "3",
      "--provider-debug",
      "--danger-review",
      "deterministic",
      "task"
    ]);

    expect(parsed.overrides).toMatchObject({
      profile: "fast",
      cwd: "/repo",
      adapter: "gemini",
      baseUrl: "https://gateway",
      apiKeyEnv: "GATEWAY_KEY",
      model: "gemini-test",
      temperature: 0,
      maxOutputTokens: 64,
      reasoningEffort: "low",
      stop: ["STOP"],
      inputCostPerMillionTokens: 1.25,
      outputCostPerMillionTokens: 10,
      maxTurns: 7,
      transcriptCompactionChars: 500,
      readOnly: true,
      providerRetries: 3,
      providerDebug: true,
      dangerReview: "deterministic"
    });
    expect(parsed.rest).toEqual(["task"]);
  });

  it("initializes a default TOML config file", () => {
    const file = join(tempDir(), ".smith", "config.toml");
    expect(initConfig(file)).toBe(file);
    expect(readFileSync(file, "utf8")).toBe(defaultConfigToml());
  });

  it("loads per-profile token pricing", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[profiles.default]
input_cost_per_million_tokens = 1.25
output_cost_per_million_tokens = 10
`,
      "utf8"
    );

    const profile = resolveProfile(loadConfig({ homeDir: tempDir(), cwd }));
    expect(profile.inputCostPerMillionTokens).toBe(1.25);
    expect(profile.outputCostPerMillionTokens).toBe(10);
  });

  it("loads per-project default benchmark profile", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[benchmark]
default_profile = "bench"

[profiles.bench]
adapter = "openai-chat"
base_url = "https://bench.example/v1"
model = "bench-model"
`,
      "utf8"
    );

    expect(loadConfig({ homeDir: tempDir(), cwd }).benchmark.defaultProfile).toBe("bench");
  });

  it("rejects invalid merged config values", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[profiles.default]
base_url = "not-a-url"
`,
      "utf8"
    );

    expect(() => loadConfig({ homeDir: tempDir(), cwd })).toThrow("profiles.default.base_url");
  });
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "smith-config-"));
}
