import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { initConfig, loadConfig, parseCliConfigOverrides, resolveProfile, userConfigPath } from "./config.js";
import { runSmithTask } from "./loop.js";
import { loadSystemPrompt } from "./prompt.js";
import { runRemoteCommand } from "./remote.js";
import { createTraceLogger } from "./trace.js";
import { runBenchmarkPath } from "./benchmark/runner.js";

export type ParsedArgs = {
  command: "help" | "version" | "run" | "remote" | "config" | "benchmark";
  prompt?: string;
  rest: string[];
};

export function parseArgs(args: string[]): ParsedArgs {
  const [first, ...rest] = args;
  if (!first || first === "-h" || first === "--help" || first === "help") {
    return { command: "help", rest };
  }
  if (first === "-v" || first === "--version" || first === "version") {
    return { command: "version", rest };
  }
  if (first === "remote" || first === "config" || first === "benchmark") {
    return { command: first, rest };
  }
  const parsed = parseCliConfigOverrides(args);
  return { command: "run", prompt: parsed.rest.join(" "), rest: args };
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.command === "help") {
    process.stdout.write(helpText());
    return;
  }
  if (parsed.command === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (parsed.command === "config") {
    await runConfigCommand(parsed.rest);
    return;
  }
  if (parsed.command === "remote") {
    await runRemoteCommand(parsed.rest);
    return;
  }
  if (parsed.command === "benchmark") {
    await runBenchmarkCommand(parsed.rest);
    return;
  }
  if (parsed.command === "run") {
    await runCommand(parsed.rest);
    return;
  }

  throw new Error(`${parsed.command} is not implemented yet`);
}

export function helpText(): string {
  return `Smith

Usage:
  smith [options] "task"
  smith remote [options] "task"
  smith config path
  smith config init
  smith benchmark run <task-or-directory>

Options:
  --cwd <dir>
  --profile <name>
  --model <model>
  --adapter <openai-chat|openai-responses|gemini|anthropic-messages>
  --base-url <url>
  --api-key-env <name>
  --temperature <number>
  --max-output-tokens <number>
  --reasoning-effort <low|medium|high>
  --stop <sequence>
  --danger-review <off|ask|llm>
`;
}

async function runCommand(args: string[]): Promise<void> {
  const { overrides, rest } = parseCliConfigOverrides(args);
  const cwd = overrides.cwd ?? process.cwd();
  const config = loadConfig({ cwd, cli: overrides });
  const profile = resolveProfile(config, overrides.profile ?? config.defaultProfile);
  const reviewerProfile = resolveProfile(config, config.runtime.dangerReviewProfile);
  const systemPrompt = loadSystemPrompt(cwd);
  const trace = createTraceLogger({
    cwd,
    profileName: overrides.profile ?? config.defaultProfile,
    profile,
    runtime: config.runtime,
    systemPrompt
  });
  const prompt = rest.join(" ").trim();

  if (!prompt) {
    await runInteractive(cwd, config.runtime, profile, reviewerProfile, systemPrompt);
    return;
  }

  await runSmithTask({
    cwd,
    prompt,
    profile,
    reviewerProfile,
    runtime: config.runtime,
    systemPrompt,
    trace,
    env: process.env,
    onTerminalOutput: (terminalOutput) => {
      process.stdout.write(`${terminalOutput}\n`);
    }
  });
}

async function runInteractive(
  cwd: string,
  runtime: ReturnType<typeof loadConfig>["runtime"],
  profile: ReturnType<typeof resolveProfile>,
  reviewerProfile: ReturnType<typeof resolveProfile>,
  systemPrompt: string
): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const prompt = (await rl.question("smith> ")).trim();
      if (!prompt || prompt === "exit" || prompt === "quit") return;
      await runSmithTask({
        cwd,
        prompt,
        profile,
        reviewerProfile,
        runtime,
        systemPrompt,
        trace: createTraceLogger({ cwd, profileName: "interactive", profile, runtime, systemPrompt }),
        env: process.env,
        onTerminalOutput: (terminalOutput) => {
          process.stdout.write(`${terminalOutput}\n`);
        }
      });
    }
  } finally {
    rl.close();
  }
}

async function runConfigCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const { overrides } = parseCliConfigOverrides(rest);
  const path = overrides.cwd ? join(overrides.cwd, ".smith", "config.toml") : userConfigPath();

  if (subcommand === "path") {
    process.stdout.write(`${path}\n`);
    return;
  }
  if (subcommand === "init") {
    process.stdout.write(`${initConfig(path)}\n`);
    return;
  }
  throw new Error("usage: smith config path|init [--cwd <directory>]");
}

async function runBenchmarkCommand(args: string[]): Promise<void> {
  const [subcommand, target, ...rest] = args;
  if (subcommand !== "run" || !target) {
    throw new Error("usage: smith benchmark run <task-or-directory> [--profile <name>]");
  }
  const { overrides } = parseCliConfigOverrides(rest);
  const results = await runBenchmarkPath(target, { profile: overrides.profile });
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    process.stdout.write(`${status} ${result.task} ${result.durationMs}ms trace=${result.traceDir}\n`);
    if (!result.passed && result.stderr) process.stderr.write(result.stderr);
  }
  if (results.some((result) => !result.passed)) {
    process.exitCode = 1;
  }
}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(here, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}
