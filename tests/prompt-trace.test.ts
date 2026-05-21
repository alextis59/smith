import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProfileConfig, RuntimeConfig } from "../src/config.js";
import { loadSystemPrompt } from "../src/prompt.js";
import { cleanupTaskMemoryFile, ensureTaskMemoryFile } from "../src/task-memory.js";
import { createTraceLogger, runsDir } from "../src/trace.js";

describe("prompt and trace", () => {
  it("does not inline SMITH.md contents into the system prompt", () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-prompt-"));
    writeFileSync(join(cwd, "SMITH.md"), "Use npm test.", "utf8");
    const prompt = loadSystemPrompt(cwd);
    expect(prompt).toContain("You are Smith");
    expect(prompt).toContain("read it explicitly");
    expect(prompt).not.toContain("Use npm test.");
  });

  it("does not inline SMITH.TASK.md contents into the system prompt", () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-task-prompt-"));
    writeFileSync(join(cwd, "SMITH.TASK.md"), "Current verifier: npm test.", "utf8");

    const prompt = loadSystemPrompt(cwd);

    expect(prompt).toContain("SMITH.TASK.md");
    expect(prompt).not.toContain("Current verifier: npm test.");
  });

  it("creates and cleans up generated task memory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-task-memory-"));
    const handle = ensureTaskMemoryFile(cwd, "Fix parser");

    expect(handle.created).toBe(true);
    const memory = readFileSync(join(cwd, "SMITH.TASK.md"), "utf8");
    expect(memory).not.toContain("Fix parser");
    expect(memory).toContain("initial request is preserved in the first user input transcript");
    expect(memory).toContain("## Working Set");
    expect(memory).toContain("Important files/functions: (unknown yet)");
    expect(memory).toContain("Current hypothesis: (unknown yet)");

    cleanupTaskMemoryFile(handle);

    expect(existsSync(join(cwd, "SMITH.TASK.md"))).toBe(false);
  });

  it("does not duplicate long initial prompts in generated task memory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-task-memory-long-"));
    const handle = ensureTaskMemoryFile(cwd, `Fix parser\n${"details\n".repeat(500)}`);

    const memory = readFileSync(join(cwd, "SMITH.TASK.md"), "utf8");

    expect(memory.length).toBeLessThan(900);
    expect(memory).not.toContain("Fix parser");
    expect(memory).not.toContain("details");
    expect(memory).toContain("initial request is preserved in the first user input transcript");

    cleanupTaskMemoryFile(handle);
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

  it("includes concise memory guidance", () => {
    const prompt = loadSystemPrompt("/");

    expect(prompt).toContain("SMITH.md is durable project memory");
    expect(prompt).toContain("SMITH.TASK.md is ephemeral task memory");
    expect(prompt).toContain("current hypothesis");
    expect(prompt).toContain("before broad further searching");
    expect(prompt).toContain("Their contents are not preloaded into this prompt");
    expect(prompt).toContain("If the note says no local memory files were found");
    expect(prompt).toContain("read the file explicitly");
  });

  it("includes concrete sub_agent delegation guidance", () => {
    const prompt = loadSystemPrompt("/");

    expect(prompt).toContain("Delegate independent work with sub_agent");
    expect(prompt).toContain("Every tool call requires a brief reason");
    expect(prompt).toContain("broad file searches");
    expect(prompt).toContain("Find how authentication tokens are parsed and validated");
    expect(prompt).toContain("Read the local docs for provider configuration");
    expect(prompt).toContain("Remove the deprecated Foo adapter");
    expect(prompt).toContain("Do not ask two sub_agent child runs to edit the same files at the same time");
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
    statefulResponses: false,
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
    transcriptCompactionMinChars: 0,
    transcriptCompactionHysteresisTurns: 0,
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
    subAgentInheritContext: true,
    remoteSessionTtlDays: 30
  };
}
