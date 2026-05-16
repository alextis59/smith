import type { CliConfigOverrides } from "./config.js";
import { loadConfig, parseCliConfigOverrides, resolveProfile } from "./config.js";
import { runSmithTask } from "./loop.js";
import { loadSystemPrompt } from "./prompt.js";
import {
  cleanupRemoteSessions,
  deleteRemoteSession,
  generateRemoteId,
  listRemoteSessions,
  loadRemoteSession,
  saveRemoteSession
} from "./remote-sessions.js";
import { createTraceLogger } from "./trace.js";
import { appendChatIn } from "./transcript.js";

export type RemoteCliOptions = {
  resume?: string;
  quiet: boolean;
  maxTurns?: number;
  configOverrides: CliConfigOverrides;
  prompt: string;
};

export async function runRemoteCommand(args: string[]): Promise<void> {
  if (args[0] === "list") {
    runRemoteList(args.slice(1));
    return;
  }
  if (args[0] === "show") {
    runRemoteShow(args.slice(1));
    return;
  }
  if (args[0] === "delete") {
    runRemoteDelete(args.slice(1));
    return;
  }
  const options = parseRemoteArgs(args);
  if (options.resume) {
    await resumeRemote(options);
  } else {
    await startRemote(options);
  }
}

export function parseRemoteArgs(args: string[]): RemoteCliOptions {
  const smithArgs: string[] = [];
  let resume: string | undefined;
  let quiet = false;
  let maxTurns: number | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--resume" || arg.startsWith("--resume=")) {
      const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
      resume = inline ?? args[++i];
      if (!resume) throw new Error("--resume requires a short id");
      continue;
    }
    if (arg === "--max-turns" || arg.startsWith("--max-turns=")) {
      const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
      const value = inline ?? args[++i];
      if (!value) throw new Error("--max-turns requires a value");
      maxTurns = Number.parseInt(value, 10);
      continue;
    }
    smithArgs.push(arg);
  }

  const parsed = parseCliConfigOverrides(smithArgs);
  return {
    resume,
    quiet,
    maxTurns,
    configOverrides: parsed.overrides,
    prompt: parsed.rest.join(" ").trim()
  };
}

async function startRemote(options: RemoteCliOptions): Promise<void> {
  if (!options.prompt) throw new Error("smith remote requires a task");
  const cwd = options.configOverrides.cwd ?? process.cwd();
  const profileName = options.configOverrides.profile ?? process.env.SMITH_PROFILE;
  const config = loadConfig({ cwd, cli: { ...options.configOverrides, profile: profileName } });
  cleanupRemoteSessions(config.runtime.remoteSessionTtlDays);
  const selectedProfile = profileName ?? config.defaultProfile;
  const profile = resolveProfile(config, selectedProfile);
  const reviewerProfile = resolveProfile(config, config.runtime.dangerReviewProfile);
  const systemPrompt = loadSystemPrompt(cwd);
  const trace = createTraceLogger({ cwd, profileName: selectedProfile, profile, runtime: config.runtime, systemPrompt });
  const result = await runSmithTask({
    cwd,
    prompt: options.prompt,
    profile,
    reviewerProfile,
    runtime: config.runtime,
    systemPrompt,
    maxTurns: options.maxTurns,
    env: { ...process.env, SMITH_PROFILE: selectedProfile },
    trace
  });

  const id = generateRemoteId();
  saveRemoteSession({
    id,
    createdAt: new Date().toISOString(),
    cwd,
    profile: selectedProfile,
    lastPrompt: options.prompt,
    lastChatOut: result.chatOut,
    transcript: result.transcript,
    tracePath: trace.path
  });
  if (!options.quiet) process.stderr.write(`smith remote session saved: ${id}\n`);
  process.stdout.write(`${result.chatOut}\n`);
}

async function resumeRemote(options: RemoteCliOptions): Promise<void> {
  if (!options.resume) throw new Error("--resume requires a short id");
  const answer = options.prompt;
  if (!answer) throw new Error("smith remote --resume requires a response");
  const session = loadRemoteSession(options.resume);
  const cwd = options.configOverrides.cwd ?? session.cwd;
  const profileName = options.configOverrides.profile ?? session.profile;
  const config = loadConfig({ cwd, cli: { ...options.configOverrides, profile: profileName } });
  cleanupRemoteSessions(config.runtime.remoteSessionTtlDays);
  const profile = resolveProfile(config, profileName);
  const reviewerProfile = resolveProfile(config, config.runtime.dangerReviewProfile);
  const systemPrompt = loadSystemPrompt(cwd);
  const trace = createTraceLogger({ cwd, profileName, profile, runtime: config.runtime, systemPrompt });
  const result = await runSmithTask({
    cwd,
    prompt: answer,
    initialTranscript: `${session.transcript}\n${appendChatIn(answer)}`,
    profile,
    reviewerProfile,
    runtime: config.runtime,
    systemPrompt,
    maxTurns: options.maxTurns,
    env: { ...process.env, SMITH_PROFILE: profileName },
    trace
  });

  saveRemoteSession({
    ...session,
    cwd,
    profile: profileName,
    lastPrompt: answer,
    lastChatOut: result.chatOut,
    transcript: result.transcript,
    tracePath: trace.path
  });
  if (!options.quiet) process.stderr.write(`smith remote session saved: ${session.id}\n`);
  process.stdout.write(`${result.chatOut}\n`);
}

function runRemoteList(args: string[]): void {
  const json = args.includes("--json");
  const sessions = listRemoteSessions();
  if (json) {
    process.stdout.write(`${JSON.stringify(sessions.map(sessionSummary), null, 2)}\n`);
    return;
  }
  for (const session of sessions) {
    process.stdout.write(
      `${session.id} updated=${session.updatedAt} profile=${session.profile} cwd=${session.cwd} prompt=${session.lastPrompt ?? ""}\n`
    );
  }
}

function runRemoteShow(args: string[]): void {
  const id = args.find((arg) => !arg.startsWith("--"));
  if (!id) throw new Error("usage: smith remote show <id> [--json]");
  const session = loadRemoteSession(id);
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `id: ${session.id}`,
      `created_at: ${session.createdAt}`,
      `updated_at: ${session.updatedAt}`,
      `cwd: ${session.cwd}`,
      `profile: ${session.profile}`,
      `last_prompt: ${session.lastPrompt ?? ""}`,
      `last_chat_out: ${session.lastChatOut ?? ""}`,
      `trace_path: ${session.tracePath ?? ""}`,
      `transcript_chars: ${session.transcript.length}`
    ].join("\n") + "\n"
  );
}

function runRemoteDelete(args: string[]): void {
  const id = args[0];
  if (!id) throw new Error("usage: smith remote delete <id>");
  deleteRemoteSession(id);
  process.stdout.write(`deleted remote session ${id}\n`);
}

function sessionSummary(session: ReturnType<typeof listRemoteSessions>[number]): Record<string, unknown> {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    cwd: session.cwd,
    profile: session.profile,
    lastPrompt: session.lastPrompt,
    lastChatOut: session.lastChatOut,
    tracePath: session.tracePath
  };
}
