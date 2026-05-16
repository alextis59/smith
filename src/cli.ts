import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { initConfig, loadConfig, parseCliConfigOverrides, resolveApiKey, resolveProfile, userConfigPath } from "./config.js";
import { runSmithTask } from "./loop.js";
import { loadSystemPrompt } from "./prompt.js";
import { runRemoteCommand } from "./remote.js";
import { createTraceLogger } from "./trace.js";
import { runBenchmarkPath, validateBenchmarkPath } from "./benchmark/runner.js";

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
  smith config doctor
  smith config show [--json]
  smith benchmark run <task-or-directory>
  smith benchmark validate <task-or-directory>

Options:
  --cwd <dir>
  --quiet
  --json
  --profile <name>
  --model <model>
  --adapter <openai-chat|openai-responses|gemini|anthropic-messages>
  --base-url <url>
  --api-key-env <name>
  --temperature <number>
  --max-output-tokens <number>
  --reasoning-effort <low|medium|high>
  --stop <sequence>
  --input-cost-per-million-tokens <usd>
  --output-cost-per-million-tokens <usd>
  --max-turns <count>
  --danger-review <off|ask|deterministic|llm>
  --read-only

Examples:
  smith --profile fast "summarize failing tests"
  smith --quiet --json "inspect package scripts"
  smith config doctor --profile default
  smith benchmark run ./benchmarks/001-release-note-summary --timeout-ms 120000
`;
}

async function runCommand(args: string[]): Promise<void> {
  const outputOptions = parseOutputOptions(args);
  const { overrides, rest } = parseCliConfigOverrides(outputOptions.rest);
  const cwd = overrides.cwd ?? process.cwd();
  const config = loadConfig({ cwd, cli: overrides });
  const selectedProfile = overrides.profile ?? config.defaultProfile;
  const profile = resolveProfile(config, selectedProfile);
  const reviewerProfile = resolveProfile(config, config.runtime.dangerReviewProfile);
  const systemPrompt = loadSystemPrompt(cwd);
  const trace = createTraceLogger({
    cwd,
    profileName: selectedProfile,
    profile,
    runtime: config.runtime,
    systemPrompt
  });
  const prompt = rest.join(" ").trim();

  if (!prompt) {
    await runInteractive(cwd, config.runtime, profile, reviewerProfile, systemPrompt);
    return;
  }

  const result = await runSmithTask({
    cwd,
    prompt,
    profile,
    reviewerProfile,
    runtime: config.runtime,
    systemPrompt,
    trace,
    env: process.env,
    onTerminalOutput: (terminalOutput) => {
      if (!outputOptions.quiet && !outputOptions.json) process.stdout.write(`${terminalOutput}\n`);
    }
  });
  if (outputOptions.json) {
    process.stdout.write(`${JSON.stringify({ chatOut: result.chatOut, turns: result.turns, usage: result.usage, tracePath: trace.path }, null, 2)}\n`);
  } else if (outputOptions.quiet) {
    process.stdout.write(`${result.chatOut}\n`);
  }
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
  const outputOptions = parseOutputOptions(rest);
  const { overrides } = parseCliConfigOverrides(outputOptions.rest);
  const path = overrides.cwd ? join(overrides.cwd, ".smith", "config.toml") : userConfigPath();

  if (subcommand === "path") {
    process.stdout.write(`${path}\n`);
    return;
  }
  if (subcommand === "init") {
    process.stdout.write(`${initConfig(path)}\n`);
    return;
  }
  if (subcommand === "show") {
    const cwd = overrides.cwd ?? process.cwd();
    const config = loadConfig({ cwd, cli: overrides });
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  if (subcommand === "doctor") {
    const cwd = overrides.cwd ?? process.cwd();
    const config = loadConfig({ cwd, cli: overrides });
    const profileName = overrides.profile ?? config.defaultProfile;
    const profile = resolveProfile(config, profileName);
    const report = {
      files: config.files,
      cwd,
      activeProfile: profileName,
      adapter: profile.adapter,
      model: profile.model,
      apiKeyEnv: profile.apiKeyEnv,
      apiKeyPresent: Boolean(resolveApiKey(profile, process.env)),
      runtime: config.runtime,
      benchmark: config.benchmark
    };
    if (outputOptions.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(formatDoctor(report));
    return;
  }
  throw new Error("usage: smith config path|init|show|doctor [--cwd <directory>] [--profile <name>]");
}

async function runBenchmarkCommand(args: string[]): Promise<void> {
  const [subcommand, target, ...rest] = args;
  if (!target || (subcommand !== "run" && subcommand !== "validate")) {
    throw new Error("usage: smith benchmark run|validate <task-or-directory> [--profile <name>]");
  }
  const options = parseBenchmarkOptions(rest);
  if (subcommand === "validate") {
    const results = validateBenchmarkPath(target);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
      for (const result of results) {
        process.stdout.write(`${result.valid ? "OK" : "FAIL"} ${result.task}${result.errors.length ? ` ${result.errors.join("; ")}` : ""}\n`);
      }
    }
    if (results.some((result) => !result.valid)) process.exitCode = 1;
    return;
  }
  const config = loadConfig({ cwd: process.cwd(), cli: options.configOverrides });
  const profile = options.configOverrides.profile ?? config.benchmark.defaultProfile;
  const results = await runBenchmarkPath(target, {
    profile,
    image: options.image,
    timeoutMs: options.timeoutMs,
    keepSandbox: options.keepSandbox
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ summary: benchmarkSummary(results), results }, null, 2)}\n`);
  } else {
    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      process.stdout.write(`${status} ${result.task} ${result.durationMs}ms trace=${result.traceDir}\n`);
      if (options.keepSandbox) process.stdout.write(`sandbox=${result.sandboxDir}\n`);
      if (!result.passed && result.stderr) process.stderr.write(result.stderr);
    }
    const summary = benchmarkSummary(results);
    process.stdout.write(`Summary: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.durationMs}ms\n`);
    if (summary.failedTasks.length > 0) process.stdout.write(`Failed tasks: ${summary.failedTasks.join(", ")}\n`);
  }
  if (results.some((result) => !result.passed)) {
    process.exitCode = 1;
  }
}

function parseOutputOptions(args: string[]): { quiet: boolean; json: boolean; rest: string[] } {
  const rest: string[] = [];
  let quiet = false;
  let json = false;
  for (const arg of args) {
    if (arg === "--quiet") quiet = true;
    else if (arg === "--json") json = true;
    else rest.push(arg);
  }
  return { quiet, json, rest };
}

function parseBenchmarkOptions(args: string[]): {
  configOverrides: ReturnType<typeof parseCliConfigOverrides>["overrides"];
  timeoutMs?: number;
  image?: string;
  json: boolean;
  keepSandbox: boolean;
} {
  const smithArgs: string[] = [];
  let timeoutMs: number | undefined;
  let image: string | undefined;
  let json = false;
  let keepSandbox = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [flag, inline] = arg.startsWith("--") ? splitFlag(arg) : [arg, undefined];
    const readValue = (): string => {
      if (inline !== undefined) return inline;
      const value = args[i + 1];
      if (value === undefined) throw new Error(`${flag} requires a value`);
      i += 1;
      return value;
    };
    if (flag === "--timeout-ms") timeoutMs = Number.parseInt(readValue(), 10);
    else if (flag === "--image") image = readValue();
    else if (flag === "--json") json = true;
    else if (flag === "--keep-sandbox") keepSandbox = true;
    else smithArgs.push(arg);
  }
  return { configOverrides: parseCliConfigOverrides(smithArgs).overrides, timeoutMs, image, json, keepSandbox };
}

function benchmarkSummary(results: Array<{ passed: boolean; durationMs: number; task: string }>) {
  const failedTasks = results.filter((result) => !result.passed).map((result) => result.task);
  return {
    total: results.length,
    passed: results.length - failedTasks.length,
    failed: failedTasks.length,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    failedTasks
  };
}

function formatDoctor(report: {
  files: string[];
  cwd: string;
  activeProfile: string;
  adapter: string;
  model: string;
  apiKeyEnv?: string;
  apiKeyPresent: boolean;
  runtime: unknown;
  benchmark: unknown;
}): string {
  return [
    `cwd: ${report.cwd}`,
    `config_files: ${report.files.length ? report.files.join(", ") : "(none)"}`,
    `active_profile: ${report.activeProfile}`,
    `adapter: ${report.adapter}`,
    `model: ${report.model}`,
    `api_key_env: ${report.apiKeyEnv ?? "(none)"}`,
    `api_key_present: ${report.apiKeyPresent ? "yes" : "no"}`,
    `runtime: ${JSON.stringify(report.runtime)}`,
    `benchmark: ${JSON.stringify(report.benchmark)}`
  ].join("\n") + "\n";
}

function splitFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(here, "../../package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}
