import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "../src/cli.js";

describe("CLI skeleton", () => {
  it("parses help and version flags", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["--version"]).command).toBe("version");
  });

  it("parses top-level commands", () => {
    expect(parseArgs(["remote", "inspect"])).toEqual({ command: "remote", rest: ["inspect"] });
    expect(parseArgs(["config", "path"])).toEqual({ command: "config", rest: ["path"] });
    expect(parseArgs(["benchmark", "run", "bench"])).toEqual({
      command: "benchmark",
      rest: ["run", "bench"]
    });
  });

  it("treats free text as a run prompt", () => {
    expect(parseArgs(["fix", "tests"])).toEqual({
      command: "run",
      prompt: "fix tests",
      rest: ["fix", "tests"]
    });
  });

  it("prints expected help sections", () => {
    expect(helpText()).toContain("smith remote");
    expect(helpText()).toContain("smith benchmark run");
    expect(helpText()).toContain("smith config doctor");
    expect(helpText()).toContain("--quiet");
    expect(helpText()).toContain("--json");
    expect(helpText()).toContain("--log-dir");
    expect(helpText()).toContain("--no-sub-agent");
    expect(helpText()).toContain("--concurrency");
    expect(helpText()).toContain("--agent <smith|codex|opencode>");
    expect(helpText()).toContain("--opencode-project");
    expect(helpText()).toContain("--opencode-mode");
    expect(helpText()).toContain("--dry-run");
  });
});
