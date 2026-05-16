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
