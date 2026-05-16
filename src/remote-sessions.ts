import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type RemoteSessionState = {
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  profile: string;
  lastPrompt?: string;
  lastChatOut?: string;
  transcript: string;
  tracePath?: string;
};

export function remoteSessionsDir(homeDir = homedir()): string {
  return join(homeDir, ".smith", "remote-sessions");
}

export function generateRemoteId(): string {
  return randomBytes(4).toString("base64url").slice(0, 6).toLowerCase();
}

export function saveRemoteSession(
  state: Omit<RemoteSessionState, "updatedAt">,
  homeDir = homedir()
): RemoteSessionState {
  const fullState: RemoteSessionState = { ...state, updatedAt: new Date().toISOString() };
  const dir = remoteSessionsDir(homeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${state.id}.json`), JSON.stringify(fullState, null, 2), "utf8");
  return fullState;
}

export function loadRemoteSession(id: string, homeDir = homedir()): RemoteSessionState {
  const file = join(remoteSessionsDir(homeDir), `${id}.json`);
  if (!existsSync(file)) throw new Error(`remote session not found: ${id}. Run 'smith remote list' to see saved sessions.`);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RemoteSessionState;
  } catch (error) {
    throw new Error(`remote session '${id}' is corrupt and cannot be resumed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function listRemoteSessions(homeDir = homedir()): RemoteSessionState[] {
  const dir = remoteSessionsDir(homeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadRemoteSession(name.slice(0, -".json".length), homeDir))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function deleteRemoteSession(id: string, homeDir = homedir()): void {
  const file = join(remoteSessionsDir(homeDir), `${id}.json`);
  if (!existsSync(file)) throw new Error(`remote session not found: ${id}`);
  rmSync(file, { force: true });
}

export function cleanupRemoteSessions(ttlDays: number, homeDir = homedir(), now = Date.now()): number {
  const cutoff = now - ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const session of listRemoteSessions(homeDir)) {
    const updated = Date.parse(session.updatedAt || session.createdAt);
    if (Number.isFinite(updated) && updated < cutoff) {
      deleteRemoteSession(session.id, homeDir);
      removed += 1;
    }
  }
  return removed;
}
