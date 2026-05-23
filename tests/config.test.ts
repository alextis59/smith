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
    expect(config.runtime.maxToolOutputChars).toBe(12000);
    expect(config.runtime.subAgentEnabled).toBe(true);
    expect(config.runtime.subAgentInheritContext).toBe(true);
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
sub_agent_enabled = false
sub_agent_inherit_context = false
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
    expect(config.runtime.subAgentEnabled).toBe(false);
    expect(config.runtime.subAgentInheritContext).toBe(false);
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
      "--stateful-responses",
      "--prompt-cache-key",
      "auto",
      "--prompt-cache-retention",
      "24h",
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
      "--cached-input-cost-per-million-tokens",
      "0.125",
      "--output-cost-per-million-tokens=10",
      "--max-turns",
      "7",
      "--max-context-tokens",
      "12000",
      "--max-tool-output-chars",
      "4096",
      "--read-only",
      "--provider-retries",
      "3",
      "--provider-timeout-ms",
      "12345",
      "--provider-debug",
      "--no-sub-agent",
      "--no-sub-agent-inherit-context",
      "--sub-agent-max-turns",
      "9",
      "--provider-message-chain",
      "--log-dir",
      "/tmp/smith",
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
      statefulResponses: true,
      promptCacheKey: "auto",
      promptCacheRetention: "24h",
      temperature: 0,
      maxOutputTokens: 64,
      reasoningEffort: "low",
      stop: ["STOP"],
      inputCostPerMillionTokens: 1.25,
      cachedInputCostPerMillionTokens: 0.125,
      outputCostPerMillionTokens: 10,
      maxTurns: 7,
      maxContextTokens: 12000,
      maxToolOutputChars: 4096,
      readOnly: true,
      providerRetries: 3,
      providerTimeoutMs: 12345,
      providerDebug: true,
      subAgentEnabled: false,
      subAgentInheritContext: false,
      subAgentMaxTurns: 9,
      logDir: "/tmp/smith",
      dangerReview: "deterministic"
    });
    expect(parsed.overrides).not.toHaveProperty("providerMessageChain");
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
cached_input_cost_per_million_tokens = 0.125
output_cost_per_million_tokens = 10
`,
      "utf8"
    );

    const profile = resolveProfile(loadConfig({ homeDir: tempDir(), cwd }));
    expect(profile.inputCostPerMillionTokens).toBe(1.25);
    expect(profile.cachedInputCostPerMillionTokens).toBe(0.125);
    expect(profile.outputCostPerMillionTokens).toBe(10);
  });

  it("loads max context tokens, max tool output chars, and migrates legacy max context chars", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[runtime]
max_context_tokens = 12345
max_tool_output_chars = 6789
`,
      "utf8"
    );

    const runtime = loadConfig({ homeDir: tempDir(), cwd }).runtime;
    expect(runtime.maxContextTokens).toBe(12345);
    expect(runtime.maxToolOutputChars).toBe(6789);

    const legacyCwd = tempDir();
    mkdirSync(join(legacyCwd, ".smith"), { recursive: true });
    writeFileSync(
      join(legacyCwd, ".smith", "config.toml"),
      `[runtime]
max_context_chars = 120000
`,
      "utf8"
    );

    expect(loadConfig({ homeDir: tempDir(), cwd: legacyCwd }).runtime.maxContextTokens).toBe(30000);
  });

  it("loads ChatGPT Codex auth profile fields", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[profiles.codex-chatgpt]
adapter = "chatgpt-codex"
base_url = "https://chatgpt.com/backend-api/codex"
model = "gpt-5.4-mini"
codex_auth_path = "/tmp/codex-auth.json"
stateful_responses = true
prompt_cache_key = "auto"
prompt_cache_retention = "24h"
`,
      "utf8"
    );

    const profile = resolveProfile(loadConfig({ homeDir: tempDir(), cwd }), "codex-chatgpt");
    expect(profile.adapter).toBe("chatgpt-codex");
    expect(profile.codexAuthPath).toBe("/tmp/codex-auth.json");
    expect(profile.statefulResponses).toBe(true);
    expect(profile.promptCacheKey).toBe("auto");
    expect(profile.promptCacheRetention).toBe("24h");
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

  it("loads log directory from config, CLI, and environment", () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, ".smith"), { recursive: true });
    writeFileSync(
      join(cwd, ".smith", "config.toml"),
      `[runtime]
log_dir = "/tmp/project-smith"
`,
      "utf8"
    );

    expect(loadConfig({ homeDir: tempDir(), cwd }).runtime.logDir).toBe("/tmp/project-smith");
    expect(loadConfig({ homeDir: tempDir(), cwd, cli: { logDir: "/tmp/cli-smith" } }).runtime.logDir).toBe(
      "/tmp/cli-smith"
    );
    expect(loadConfig({ homeDir: tempDir(), cwd: tempDir(), env: { SMITH_LOG_DIR: "/tmp/env-smith" } }).runtime.logDir).toBe(
      "/tmp/env-smith"
    );
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
