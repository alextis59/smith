import { existsSync, readFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { initConfig, loadConfig, parseCliConfigOverrides, resolveApiKey, resolveProfile, userConfigPath } from "./config.js";
import { prepareSmithEnvironment, runSmithTask } from "./loop.js";
import { loadSystemPrompt } from "./prompt.js";
import { runRemoteCommand } from "./remote.js";
import { summarizeTrace, writeSessionLog } from "./session-log.js";
import { TASK_MEMORY_FILE } from "./task-memory.js";
import { createTraceLogger } from "./trace.js";
import {
  runBenchmarkPath,
  validateBenchmarkPath,
  type BenchmarkAgent,
  type BenchmarkCostRates,
  type BenchmarkOpencodeMode,
  type BenchmarkUsage
} from "./benchmark/runner.js";

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
  --stateful-responses
  --prompt-cache-key <key|auto>
  --prompt-cache-retention <in_memory|24h>
  --adapter <openai-chat|openai-responses|chatgpt-codex|gemini|anthropic-messages>
  --base-url <url>
  --api-key-env <name>
  --codex-auth-path <path>
  --temperature <number>
  --max-output-tokens <number>
  --reasoning-effort <low|medium|high>
  --stop <sequence>
  --input-cost-per-million-tokens <usd>
  --output-cost-per-million-tokens <usd>
  --max-turns <count>
  --max-context-tokens <tokens>
  --danger-review <off|ask|deterministic|llm>
  --read-only
  --provider-debug
  --log-dir <dir>
  --no-sub-agent
  --agent <smith|codex|opencode>
  --opencode-project <dir>
  --opencode-mode <tools|file-output>
  --opencode-retries <count>
  --dry-run
  --concurrency <count>
  --cached-input-cost-per-million-tokens <usd>
  --provider-timeout-ms <milliseconds>
  --max-run-ms <milliseconds>
  --sub-agent-max-turns <count>

Examples:
  smith --profile fast "summarize failing tests"
  smith --quiet --json "inspect package scripts"
  smith config doctor --profile default
  smith benchmark run ./benchmarks/001-release-note-summary --timeout-ms 120000
  smith benchmark run ./benchmarks --agent codex --model gpt-5.4-mini --reasoning-effort high --concurrency 5
  smith benchmark run ./benchmarks/001-release-note-summary --agent opencode --model vibethinker-local/vibethinker-3b --opencode-project ../local-opencode --dry-run
  smith benchmark run swe-bench-pro --timeout-ms 900000
  smith benchmark run swe-bench-pro/001-nodebb-nodebb-vnan --timeout-ms 900000
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
  const prompt = rest.join(" ").trim();
  const existingTaskMemory = existsSync(join(cwd, TASK_MEMORY_FILE));

  try {
    const systemPrompt = loadSystemPrompt(cwd);
    const startedAt = new Date().toISOString();
    const trace = createTraceLogger({
      cwd,
      profileName: selectedProfile,
      profile,
      runtime: config.runtime,
      systemPrompt
    });

    if (!prompt) {
      await runInteractive(cwd, config.runtime, profile, reviewerProfile, systemPrompt);
      return;
    }

    const environment = await prepareSmithEnvironment({
      cwd,
      prompt,
      profile,
      reviewerProfile,
      runtime: config.runtime,
      systemPrompt,
      reloadSystemPrompt: () => loadSystemPrompt(cwd),
      trace,
      env: process.env
    });

    const result = await runSmithTask({
      cwd,
      prompt,
      profile,
      reviewerProfile,
      runtime: config.runtime,
      systemPrompt: environment.systemPrompt,
      reloadSystemPrompt: () => loadSystemPrompt(cwd),
      trace,
      initialUsage: environment.usage,
      env: process.env,
      onTerminalOutput: (terminalOutput) => {
        if (!outputOptions.quiet && !outputOptions.json) process.stdout.write(`${terminalOutput}\n`);
      }
    });
    const logPath = writeSessionLog(config.runtime.logDir, "run", {
      kind: "smith.run",
      startedAt,
      completedAt: new Date().toISOString(),
      cwd,
      command: `smith ${args.map(shellQuoteForLog).join(" ")}`,
      profile: selectedProfile,
      adapter: profile.adapter,
      model: profile.model,
      turns: result.turns,
      tracePath: trace.path,
      usage: result.usage,
      chatOut: result.chatOut,
      ...summarizeTrace(trace.path)
    });
    if (outputOptions.json) {
      process.stdout.write(`${JSON.stringify({ chatOut: result.chatOut, turns: result.turns, usage: result.usage, tracePath: trace.path, logPath }, null, 2)}\n`);
    } else {
      process.stdout.write(`${result.chatOut}\n`);
    }
  } finally {
    if (!existingTaskMemory) rmSync(join(cwd, TASK_MEMORY_FILE), { force: true });
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
    const trace = createTraceLogger({ cwd, profileName: "interactive-startup", profile, runtime, systemPrompt });
    const environment = await prepareSmithEnvironment({
      cwd,
      prompt: "Prepare this interactive Smith session environment.",
      profile,
      reviewerProfile,
      runtime,
      systemPrompt,
      reloadSystemPrompt: () => loadSystemPrompt(cwd),
      trace,
      env: process.env
    });
    systemPrompt = environment.systemPrompt;
    let initialUsage = environment.usage;
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
        initialUsage,
        reloadSystemPrompt: () => loadSystemPrompt(cwd),
        trace: createTraceLogger({ cwd, profileName: "interactive", profile, runtime, systemPrompt }),
        env: process.env,
        onTerminalOutput: (terminalOutput) => {
          process.stdout.write(`${terminalOutput}\n`);
        }
      });
      initialUsage = undefined;
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
  const agent = options.agent ?? "smith";
  const config = agent === "smith" ? loadConfig({ cwd: process.cwd(), cli: options.configOverrides }) : undefined;
  const profile = options.configOverrides.profile ?? config?.benchmark.defaultProfile;
  const resolvedProfile = config ? resolveProfile(config, profile) : undefined;
  const model = options.configOverrides.model ?? resolvedProfile?.model;
  const cost = benchmarkCostRates({
    agent,
    model,
    cliInputCost: options.configOverrides.inputCostPerMillionTokens,
    cliCachedInputCost: options.cachedInputCostPerMillionTokens,
    cliOutputCost: options.configOverrides.outputCostPerMillionTokens,
    profileCost: resolvedProfile
      ? {
          inputCostPerMillionTokens: resolvedProfile.inputCostPerMillionTokens,
          cachedInputCostPerMillionTokens: resolvedProfile.cachedInputCostPerMillionTokens,
          outputCostPerMillionTokens: resolvedProfile.outputCostPerMillionTokens
        }
      : undefined
  });
  const results = await runBenchmarkPath(target, {
    agent,
    profile,
    smithArgs: options.smithArgs,
    model,
    reasoningEffort: options.configOverrides.reasoningEffort,
    image: options.image,
    timeoutMs: options.timeoutMs,
    keepSandbox: options.keepSandbox,
    concurrency: options.concurrency,
    cost,
    logDir: options.logDir,
    dryRun: options.dryRun,
    opencodeProject: options.opencodeProject,
    opencodeMode: options.opencodeMode,
    opencodeRetries: options.opencodeRetries
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ summary: benchmarkSummary(results), results }, null, 2)}\n`);
  } else {
    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      const costText = result.usage?.costUsd !== undefined ? ` cost=$${result.usage.costUsd.toFixed(6)}` : "";
      const logText = result.logPath ? ` log=${result.logPath}` : "";
      process.stdout.write(`${status} ${result.task} ${result.durationMs}ms${costText} trace=${result.traceDir}${logText}\n`);
      if (options.keepSandbox) process.stdout.write(`sandbox=${result.sandboxDir}\n`);
      if (!result.passed && result.stderr) process.stderr.write(result.stderr);
    }
    const summary = benchmarkSummary(results);
    const costText = summary.costUsd !== undefined ? `, cost=$${summary.costUsd.toFixed(6)}` : "";
    process.stdout.write(`Summary: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.durationMs}ms${costText}\n`);
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
  smithArgs: string[];
  timeoutMs?: number;
  image?: string;
  agent?: BenchmarkAgent;
  json: boolean;
  keepSandbox: boolean;
  concurrency?: number;
  cachedInputCostPerMillionTokens?: number;
  logDir?: string;
  dryRun: boolean;
  opencodeProject?: string;
  opencodeMode?: BenchmarkOpencodeMode;
  opencodeRetries?: number;
} {
  const smithArgs: string[] = [];
  let timeoutMs: number | undefined;
  let image: string | undefined;
  let agent: BenchmarkAgent | undefined;
  let json = false;
  let keepSandbox = false;
  let concurrency: number | undefined;
  let cachedInputCostPerMillionTokens: number | undefined;
  let logDir: string | undefined;
  let dryRun = false;
  let opencodeProject: string | undefined;
  let opencodeMode: BenchmarkOpencodeMode | undefined;
  let opencodeRetries: number | undefined;
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
    else if (flag === "--agent") agent = parseBenchmarkAgent(readValue());
    else if (flag === "--json") json = true;
    else if (flag === "--keep-sandbox") keepSandbox = true;
    else if (flag === "--concurrency") concurrency = parsePositiveInteger(readValue(), "--concurrency");
    else if (flag === "--cached-input-cost-per-million-tokens") {
      const value = readValue();
      cachedInputCostPerMillionTokens = Number(value);
      if (inline !== undefined) smithArgs.push(arg);
      else smithArgs.push(flag, value);
    } else if (flag === "--log-dir") logDir = readValue();
    else if (flag === "--dry-run") dryRun = true;
    else if (flag === "--opencode-project") opencodeProject = readValue();
    else if (flag === "--opencode-mode") opencodeMode = parseOpencodeMode(readValue());
    else if (flag === "--opencode-retries") opencodeRetries = parseNonNegativeInteger(readValue(), "--opencode-retries");
    else smithArgs.push(arg);
  }
  return {
    configOverrides: parseCliConfigOverrides(smithArgs).overrides,
    smithArgs,
    timeoutMs,
    image,
    agent,
    json,
    keepSandbox,
    concurrency,
    cachedInputCostPerMillionTokens,
    logDir,
    dryRun,
    opencodeProject,
    opencodeMode,
    opencodeRetries
  };
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseBenchmarkAgent(value: string): BenchmarkAgent {
  if (value === "smith" || value === "codex" || value === "opencode") return value;
  throw new Error(`unsupported benchmark agent '${value}'`);
}

function parseOpencodeMode(value: string): BenchmarkOpencodeMode {
  if (value === "tools" || value === "file-output") return value;
  throw new Error(`unsupported opencode benchmark mode '${value}'`);
}

function benchmarkSummary(results: Array<{ passed: boolean; durationMs: number; task: string; usage?: BenchmarkUsage }>) {
  const failedTasks = results.filter((result) => !result.passed).map((result) => result.task);
  const usage = addBenchmarkUsage(results.map((result) => result.usage));
  return {
    total: results.length,
    passed: results.length - failedTasks.length,
    failed: failedTasks.length,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    usage,
    ...(usage?.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    failedTasks
  };
}

function addBenchmarkUsage(usages: Array<BenchmarkUsage | undefined>): BenchmarkUsage | undefined {
  let total: BenchmarkUsage | undefined;
  for (const usage of usages) {
    if (!usage) continue;
    total = {
      inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
      cachedInputTokens: (total?.cachedInputTokens ?? 0) + usage.cachedInputTokens,
      outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
      reasoningOutputTokens: (total?.reasoningOutputTokens ?? 0) + usage.reasoningOutputTokens,
      totalTokens: (total?.totalTokens ?? 0) + usage.totalTokens,
      ...((total?.costUsd !== undefined || usage.costUsd !== undefined)
        ? { costUsd: (total?.costUsd ?? 0) + (usage.costUsd ?? 0) }
        : {})
    };
  }
  return total;
}

function benchmarkCostRates(options: {
  agent: BenchmarkAgent;
  model?: string;
  cliInputCost?: number;
  cliCachedInputCost?: number;
  cliOutputCost?: number;
  profileCost?: {
    inputCostPerMillionTokens?: number;
    cachedInputCostPerMillionTokens?: number;
    outputCostPerMillionTokens?: number;
  };
}): BenchmarkCostRates | undefined {
  const modelRates = options.agent === "codex" ? defaultModelCostRates(options.model) : undefined;
  const rates = {
    inputCostPerMillionTokens:
      options.cliInputCost ?? options.profileCost?.inputCostPerMillionTokens ?? modelRates?.inputCostPerMillionTokens,
    cachedInputCostPerMillionTokens:
      options.cliCachedInputCost ??
      options.profileCost?.cachedInputCostPerMillionTokens ??
      modelRates?.cachedInputCostPerMillionTokens,
    outputCostPerMillionTokens:
      options.cliOutputCost ?? options.profileCost?.outputCostPerMillionTokens ?? modelRates?.outputCostPerMillionTokens
  };
  return rates.inputCostPerMillionTokens === undefined &&
    rates.cachedInputCostPerMillionTokens === undefined &&
    rates.outputCostPerMillionTokens === undefined
    ? undefined
    : rates;
}

function defaultModelCostRates(model: string | undefined): BenchmarkCostRates | undefined {
  if (model === "gpt-5.4-mini" || model === "gpt5.4-mini") {
    return {
      inputCostPerMillionTokens: 0.75,
      cachedInputCostPerMillionTokens: 0.075,
      outputCostPerMillionTokens: 4.5
    };
  }
  return undefined;
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

function shellQuoteForLog(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}
