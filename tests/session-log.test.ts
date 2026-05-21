import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeProviderEvents, summarizeTraceText, writeSessionLog } from "../src/session-log.js";

describe("session logs", () => {
  it("writes redacted JSON logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "smith-session-log-"));

    const path = writeSessionLog(dir, "task/001", {
      command: "TOKEN=secret smith run",
      headers: { Authorization: "Bearer secret-token" },
      terminalOutput: "curl -H 'Authorization: Bearer secret-token'",
      tokens: { access_token: "access", refresh_token: "refresh-secret" }
    });

    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
    const text = readFileSync(path!, "utf8");
    expect(text).toContain("TOKEN=[redacted]");
    expect(text).toContain("Bearer [redacted]");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("refresh-secret");
  });

  it("summarizes provider events and trace sections", () => {
    const events = summarizeProviderEvents([
      { type: "response.output_text.delta", delta: "pwd" },
      { type: "response.output_text.done", text: "pwd" },
      { type: "response.output_item.added", item: { type: "function_call", name: "run" } }
    ]);

    expect(events).toEqual([
      { type: "response.output_text.done", text: "pwd" },
      { type: "response.output_item.added", itemType: "function_call", name: "run" }
    ]);

    const trace = summarizeTraceText(
      [
        "## model output",
        "pwd",
        "## parsed events",
        JSON.stringify(events, null, 2),
        "## terminal output",
        "/repo",
        "## finish",
        "done"
      ].join("\n")
    );

    expect(trace.modelOutputs).toEqual(["pwd"]);
    expect(trace.terminalOutputs).toEqual(["/repo"]);
    expect(trace.parsedEvents).toEqual(events);
    expect(trace.chatOut).toBe("done");
  });
});
