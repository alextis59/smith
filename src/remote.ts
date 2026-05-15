import type { CliConfigOverrides } from "./config.js";
import { loadConfig, parseCliConfigOverrides, resolveProfile } from "./config.js";
import { runSmithTask } from "./loop.js";
import { loadSystemPrompt } from "./prompt.js";
import { generateRemoteId, loadRemoteSession, saveRemoteSession } from "./remote-sessions.js";
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
    transcript: result.transcript,
    tracePath: trace.path
  });
  if (!options.quiet) process.stderr.write(`smith remote session saved: ${session.id}\n`);
  process.stdout.write(`${result.chatOut}\n`);
}
