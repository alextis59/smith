import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupRemoteSessions,
  deleteRemoteSession,
  generateRemoteId,
  listRemoteSessions,
  loadRemoteSession,
  remoteSessionsDir,
  saveRemoteSession
} from "../src/remote-sessions.js";
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

  it("lists, deletes, and cleans up old sessions", () => {
    const home = mkdtempSync(join(tmpdir(), "smith-remote-home-"));
    saveRemoteSession(
      {
        id: "old123",
        createdAt: "2026-01-01T00:00:00.000Z",
        cwd: "/repo",
        profile: "fast",
        lastPrompt: "old",
        transcript: "old"
      },
      home
    );
    writeFileSync(
      join(remoteSessionsDir(home), "old123.json"),
      JSON.stringify({
        id: "old123",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        cwd: "/repo",
        profile: "fast",
        lastPrompt: "old",
        transcript: "old"
      }),
      "utf8"
    );
    saveRemoteSession(
      {
        id: "new123",
        createdAt: "2026-05-15T00:00:00.000Z",
        cwd: "/repo",
        profile: "fast",
        lastPrompt: "new",
        transcript: "new"
      },
      home
    );

    expect(listRemoteSessions(home).map((session) => session.id).sort()).toEqual(["new123", "old123"]);
    expect(cleanupRemoteSessions(1, home, Date.parse("2026-05-16T00:00:00.000Z"))).toBe(1);
    expect(listRemoteSessions(home).map((session) => session.id)).toEqual(["new123"]);
    deleteRemoteSession("new123", home);
    expect(listRemoteSessions(home)).toEqual([]);
  });

  it("explains missing and corrupt sessions", () => {
    const home = mkdtempSync(join(tmpdir(), "smith-remote-home-"));
    expect(() => loadRemoteSession("none", home)).toThrow("smith remote list");
    mkdirSync(remoteSessionsDir(home), { recursive: true });
    writeFileSync(join(remoteSessionsDir(home), "bad123.json"), "{", "utf8");
    expect(() => loadRemoteSession("bad123", home)).toThrow("corrupt");
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
