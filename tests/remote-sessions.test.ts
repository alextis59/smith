import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateRemoteId, loadRemoteSession, saveRemoteSession } from "../src/remote-sessions.js";
import { parseRemoteArgs } from "../src/remote.js";

describe("remote sessions", () => {
  it("generates short ids and persists state", () => {
    const home = mkdtempSync(join(tmpdir(), "smith-remote-home-"));
    const id = generateRemoteId();
    expect(id).toMatch(/^[a-z0-9_-]{6}$/);

    saveRemoteSession(
      {
        id,
        createdAt: "2026-05-15T00:00:00.000Z",
        cwd: "/repo",
        profile: "fast",
        transcript: "hello"
      },
      home
    );

    expect(loadRemoteSession(id, home)).toMatchObject({ id, cwd: "/repo", profile: "fast", transcript: "hello" });
  });

  it("parses remote-specific flags separately from Smith config flags", () => {
    const parsed = parseRemoteArgs([
      "--quiet",
      "--max-turns",
      "3",
      "--profile",
      "fast",
      "--resume",
      "abc123",
      "answer"
    ]);
    expect(parsed).toMatchObject({
      quiet: true,
      maxTurns: 3,
      resume: "abc123",
      configOverrides: { profile: "fast" },
      prompt: "answer"
    });
  });
});
