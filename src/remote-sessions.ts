import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type RemoteSessionState = {
  id: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  profile: string;
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
  if (!existsSync(file)) throw new Error(`remote session not found: ${id}`);
  return JSON.parse(readFileSync(file, "utf8")) as RemoteSessionState;
}
