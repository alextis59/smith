import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProfileConfig, RuntimeConfig } from "../src/config.js";
import { loadSystemPrompt } from "../src/prompt.js";
import { createTraceLogger, runsDir } from "../src/trace.js";

describe("prompt and trace", () => {
  it("loads packaged prompt with additive SMITH.md instructions", () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-prompt-"));
    writeFileSync(join(cwd, "SMITH.md"), "Use npm test.", "utf8");
    const prompt = loadSystemPrompt(cwd);
    expect(prompt).toContain("You are Smith");
    expect(prompt).toContain("Use npm test.");
  });

  it("includes benchmark-hardened shell guidance", () => {
    const prompt = loadSystemPrompt("/");

    expect(prompt).toContain("do not repeat the same inspection command");
    expect(prompt).toContain("Do not run git status, git diff, or .git probes as default self-checks");
    expect(prompt).toContain("printf '%s\\n' '--- label ---'");
    expect(prompt).toContain("Do not treat your own command labels, comments, or exploratory questions printed in terminal output as user requests");
    expect(prompt).toContain("avoid broad recursive searches through dependency, build, generated, or localization trees");
    expect(prompt).toContain("source top-level Markdown heading or version label verbatim");
    expect(prompt).toContain("copy factual bullets or labeled facts");
    expect(prompt).toContain("original source bullet text verbatim");
  });

  it("includes concrete remote delegation guidance", () => {
    const prompt = loadSystemPrompt("/");

    expect(prompt).toContain("Delegate independent work with remote Smith");
    expect(prompt).toContain('smith remote --cwd ./path "task"');
    expect(prompt).toContain("Find how authentication tokens are parsed and validated");
    expect(prompt).toContain("Read the local docs for provider configuration");
    expect(prompt).toContain("Remove the deprecated Foo adapter");
    expect(prompt).toContain("Do not ask two remote Smith runs to edit the same files at the same time");
  });

  it("writes trace files under ~/.smith/runs", () => {
    const home = mkdtempSync(join(tmpdir(), "smith-trace-home-"));
    const logger = createTraceLogger({
      cwd: "/repo",
      profileName: "default",
      profile: profile(),
      runtime: runtime(),
      systemPrompt: "system",
      homeDir: home
    });
    logger.write("model output", "echo hi");

    expect(logger.path.startsWith(runsDir(home))).toBe(true);
    expect(existsSync(logger.path)).toBe(true);
    expect(readFileSync(logger.path, "utf8")).toContain("adapter: openai-chat");
    expect(readFileSync(logger.path, "utf8")).toContain("echo hi");
  });
});

function profile(): ProfileConfig {
  return {
    adapter: "openai-chat",
    baseUrl: "https://fake.test/v1",
    model: "fake",
    headers: {},
    body: {},
    strictProviderOptions: false
  };
}

function runtime(): RuntimeConfig {
  return {
    shell: "bash",
    timeoutMs: 5000,
    transcriptTurns: 20,
    maxContextChars: 10000,
    maxTurns: 20,
    transcriptCompactionChars: 1000,
    dangerReview: "off",
    dangerReviewProfile: "reviewer",
    traceRaw: false,
    readOnly: false,
    providerRetries: 2,
    providerRetryDelayMs: 1,
    providerDebug: false,
    remoteSessionTtlDays: 30
  };
}
