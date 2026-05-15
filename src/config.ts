import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";

export type AdapterName = "openai-chat" | "openai-responses" | "gemini" | "anthropic-messages";
export type ReasoningEffort = "low" | "medium" | "high";
export type DangerReviewMode = "off" | "ask" | "llm";

export type ProfileConfig = {
  adapter: AdapterName;
  baseUrl: string;
  apiKeyEnv?: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stop?: string[];
  headers: Record<string, string>;
  body: Record<string, unknown>;
  strictProviderOptions: boolean;
};

export type RuntimeConfig = {
  shell: string;
  timeoutMs: number;
  transcriptTurns: number;
  maxContextChars: number;
  dangerReview: DangerReviewMode;
  dangerReviewProfile: string;
  traceRaw: boolean;
};

export type SmithConfig = {
  defaultProfile: string;
  profiles: Record<string, ProfileConfig>;
  runtime: RuntimeConfig;
  files: string[];
};

export type ConfigLoadOptions = {
  cwd?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  cli?: CliConfigOverrides;
};

export type CliConfigOverrides = {
  profile?: string;
  cwd?: string;
  adapter?: AdapterName;
  baseUrl?: string;
  apiKeyEnv?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stop?: string[];
  shell?: string;
  timeoutMs?: number;
  transcriptTurns?: number;
  maxContextChars?: number;
  dangerReview?: DangerReviewMode;
  dangerReviewProfile?: string;
  traceRaw?: boolean;
};

type RawConfig = Record<string, unknown>;

const DEFAULT_CONFIG: SmithConfig = {
  defaultProfile: "default",
  profiles: {
    default: {
      adapter: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-5.4",
      temperature: 0.2,
      maxOutputTokens: 4096,
      reasoningEffort: "medium",
      headers: {},
      body: {},
      strictProviderOptions: false
    },
    reviewer: {
      adapter: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-5.4-mini",
      temperature: 0,
      headers: {},
      body: {},
      strictProviderOptions: false
    }
  },
  runtime: {
    shell: "bash",
    timeoutMs: 120_000,
    transcriptTurns: 20,
    maxContextChars: 120_000,
    dangerReview: "llm",
    dangerReviewProfile: "reviewer",
    traceRaw: false
  },
  files: []
};

export function defaultConfig(): SmithConfig {
  return cloneConfig(DEFAULT_CONFIG);
}

export function userConfigPath(homeDir = homedir()): string {
  return join(homeDir, ".smith", "config.toml");
}

export function projectConfigPath(cwd = process.cwd()): string {
  return join(cwd, ".smith", "config.toml");
}

export function loadConfig(options: ConfigLoadOptions = {}): SmithConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = options.homeDir ?? homedir();
  let config = defaultConfig();
  const files: string[] = [];

  for (const file of [userConfigPath(home), projectConfigPath(cwd)]) {
    if (!existsSync(file)) continue;
    config = mergeRawConfig(config, parseConfigFile(file));
    files.push(file);
  }

  if (options.cli) {
    config = applyCliOverrides(config, options.cli);
  }

  config.files = files;
  return config;
}

export function initConfig(file = userConfigPath()): string {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, defaultConfigToml(), "utf8");
  }
  return file;
}

export function resolveProfile(config: SmithConfig, name = config.defaultProfile): ProfileConfig {
  const profile = config.profiles[name];
  if (!profile) {
    throw new Error(`unknown profile '${name}'`);
  }
  return profile;
}

export function resolveApiKey(profile: ProfileConfig, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return profile.apiKeyEnv ? env[profile.apiKeyEnv] : undefined;
}

export function parseCliConfigOverrides(args: string[]): { overrides: CliConfigOverrides; rest: string[] } {
  const overrides: CliConfigOverrides = {};
  const rest: string[] = [];

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

    switch (flag) {
      case "--profile":
        overrides.profile = readValue();
        break;
      case "--cwd":
        overrides.cwd = readValue();
        break;
      case "--adapter":
        overrides.adapter = parseAdapter(readValue());
        break;
      case "--base-url":
        overrides.baseUrl = readValue();
        break;
      case "--api-key-env":
        overrides.apiKeyEnv = readValue();
        break;
      case "--model":
        overrides.model = readValue();
        break;
      case "--temperature":
        overrides.temperature = Number(readValue());
        break;
      case "--max-output-tokens":
        overrides.maxOutputTokens = Number.parseInt(readValue(), 10);
        break;
      case "--reasoning-effort":
        overrides.reasoningEffort = parseReasoningEffort(readValue());
        break;
      case "--stop":
        overrides.stop = [...(overrides.stop ?? []), readValue()];
        break;
      case "--shell":
        overrides.shell = readValue();
        break;
      case "--timeout-ms":
        overrides.timeoutMs = Number.parseInt(readValue(), 10);
        break;
      case "--transcript-turns":
        overrides.transcriptTurns = Number.parseInt(readValue(), 10);
        break;
      case "--max-context-chars":
        overrides.maxContextChars = Number.parseInt(readValue(), 10);
        break;
      case "--danger-review":
        overrides.dangerReview = parseDangerReview(readValue());
        break;
      case "--danger-review-profile":
        overrides.dangerReviewProfile = readValue();
        break;
      case "--trace-raw":
        overrides.traceRaw = true;
        break;
      default:
        rest.push(arg);
    }
  }

  return { overrides, rest };
}

export function defaultConfigToml(): string {
  return `default_profile = "default"

[profiles.default]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4"
temperature = 0.2
max_output_tokens = 4096
reasoning_effort = "medium"

[profiles.reviewer]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4-mini"
temperature = 0

[runtime]
shell = "bash"
timeout_ms = 120000
transcript_turns = 20
max_context_chars = 120000
danger_review = "llm"
danger_review_profile = "reviewer"
`;
}

function parseConfigFile(file: string): RawConfig {
  return parseToml(readFileSync(file, "utf8")) as RawConfig;
}

function mergeRawConfig(config: SmithConfig, raw: RawConfig): SmithConfig {
  const next = cloneConfig(config);

  if (typeof raw.default_profile === "string") {
    next.defaultProfile = raw.default_profile;
  }

  if (isObject(raw.profiles)) {
    for (const [name, rawProfile] of Object.entries(raw.profiles)) {
      if (!isObject(rawProfile)) continue;
      const previous = next.profiles[name] ?? {
        adapter: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        headers: {},
        body: {},
        strictProviderOptions: false
      };
      next.profiles[name] = mergeProfile(previous, rawProfile);
    }
  }

  if (isObject(raw.runtime)) {
    next.runtime = mergeRuntime(next.runtime, raw.runtime);
  }

  return next;
}

function applyCliOverrides(config: SmithConfig, cli: CliConfigOverrides): SmithConfig {
  const next = cloneConfig(config);
  const selected = cli.profile ?? next.defaultProfile;
  if (cli.profile) next.defaultProfile = cli.profile;

  const profile = resolveProfile(next, selected);
  next.profiles[selected] = {
    ...profile,
    ...(cli.adapter ? { adapter: cli.adapter } : {}),
    ...(cli.baseUrl ? { baseUrl: cli.baseUrl } : {}),
    ...(cli.apiKeyEnv ? { apiKeyEnv: cli.apiKeyEnv } : {}),
    ...(cli.model ? { model: cli.model } : {}),
    ...(cli.temperature !== undefined ? { temperature: cli.temperature } : {}),
    ...(cli.maxOutputTokens !== undefined ? { maxOutputTokens: cli.maxOutputTokens } : {}),
    ...(cli.reasoningEffort ? { reasoningEffort: cli.reasoningEffort } : {}),
    ...(cli.stop ? { stop: cli.stop } : {})
  };

  next.runtime = {
    ...next.runtime,
    ...(cli.shell ? { shell: cli.shell } : {}),
    ...(cli.timeoutMs !== undefined ? { timeoutMs: cli.timeoutMs } : {}),
    ...(cli.transcriptTurns !== undefined ? { transcriptTurns: cli.transcriptTurns } : {}),
    ...(cli.maxContextChars !== undefined ? { maxContextChars: cli.maxContextChars } : {}),
    ...(cli.dangerReview ? { dangerReview: cli.dangerReview } : {}),
    ...(cli.dangerReviewProfile ? { dangerReviewProfile: cli.dangerReviewProfile } : {}),
    ...(cli.traceRaw !== undefined ? { traceRaw: cli.traceRaw } : {})
  };

  return next;
}

function mergeProfile(previous: ProfileConfig, raw: RawConfig): ProfileConfig {
  return {
    ...previous,
    ...(raw.adapter ? { adapter: parseAdapter(String(raw.adapter)) } : {}),
    ...(typeof raw.base_url === "string" ? { baseUrl: raw.base_url } : {}),
    ...(typeof raw.api_key_env === "string" ? { apiKeyEnv: raw.api_key_env } : {}),
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(typeof raw.temperature === "number" ? { temperature: raw.temperature } : {}),
    ...(typeof raw.max_output_tokens === "number" ? { maxOutputTokens: raw.max_output_tokens } : {}),
    ...(typeof raw.reasoning_effort === "string"
      ? { reasoningEffort: parseReasoningEffort(raw.reasoning_effort) }
      : {}),
    ...(Array.isArray(raw.stop) ? { stop: raw.stop.map(String) } : {}),
    ...(isObject(raw.headers) ? { headers: stringifyRecord(raw.headers) } : {}),
    ...(isObject(raw.body) ? { body: raw.body } : {}),
    ...(typeof raw.strict_provider_options === "boolean"
      ? { strictProviderOptions: raw.strict_provider_options }
      : {})
  };
}

function mergeRuntime(previous: RuntimeConfig, raw: RawConfig): RuntimeConfig {
  return {
    ...previous,
    ...(typeof raw.shell === "string" ? { shell: raw.shell } : {}),
    ...(typeof raw.timeout_ms === "number" ? { timeoutMs: raw.timeout_ms } : {}),
    ...(typeof raw.transcript_turns === "number" ? { transcriptTurns: raw.transcript_turns } : {}),
    ...(typeof raw.max_context_chars === "number" ? { maxContextChars: raw.max_context_chars } : {}),
    ...(typeof raw.danger_review === "string" ? { dangerReview: parseDangerReview(raw.danger_review) } : {}),
    ...(typeof raw.danger_review_profile === "string" ? { dangerReviewProfile: raw.danger_review_profile } : {}),
    ...(typeof raw.trace_raw === "boolean" ? { traceRaw: raw.trace_raw } : {})
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function parseAdapter(value: string): AdapterName {
  if (
    value === "openai-chat" ||
    value === "openai-responses" ||
    value === "gemini" ||
    value === "anthropic-messages"
  ) {
    return value;
  }
  throw new Error(`unknown adapter '${value}'`);
}

function parseReasoningEffort(value: string): ReasoningEffort {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error(`unknown reasoning effort '${value}'`);
}

function parseDangerReview(value: string): DangerReviewMode {
  if (value === "off" || value === "ask" || value === "llm") return value;
  throw new Error(`unknown danger review mode '${value}'`);
}

function stringifyRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneConfig(config: SmithConfig): SmithConfig {
  return {
    defaultProfile: config.defaultProfile,
    profiles: Object.fromEntries(
      Object.entries(config.profiles).map(([name, profile]) => [
        name,
        {
          ...profile,
          headers: { ...profile.headers },
          body: structuredClone(profile.body),
          stop: profile.stop ? [...profile.stop] : undefined
        }
      ])
    ),
    runtime: { ...config.runtime },
    files: [...config.files]
  };
}

export function nearestProjectRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = parsePath(current).dir;
    if (parent === current) return start;
    current = parent;
  }
}
