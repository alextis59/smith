import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";

export type AdapterName = "openai-chat" | "openai-responses" | "chatgpt-codex" | "gemini" | "anthropic-messages";
export type ReasoningEffort = "low" | "medium" | "high";
export type DangerReviewMode = "off" | "ask" | "deterministic" | "llm";

export type ProfileConfig = {
  adapter: AdapterName;
  baseUrl: string;
  apiKeyEnv?: string;
  codexAuthPath?: string;
  model: string;
  statefulResponses: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stop?: string[];
  inputCostPerMillionTokens?: number;
  cachedInputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  strictProviderOptions: boolean;
};

export type RuntimeConfig = {
  shell: string;
  timeoutMs: number;
  transcriptTurns: number;
  transcriptCompactionMinChars: number;
  transcriptCompactionHysteresisTurns: number;
  maxContextChars: number;
  maxTurns: number;
  transcriptCompactionChars: number;
  dangerReview: DangerReviewMode;
  dangerReviewProfile: string;
  traceRaw: boolean;
  readOnly: boolean;
  providerRetries: number;
  providerRetryDelayMs: number;
  providerDebug: boolean;
  subAgentInheritContext: boolean;
  remoteSessionTtlDays: number;
  logDir?: string;
};

export type SmithConfig = {
  defaultProfile: string;
  benchmark: {
    defaultProfile?: string;
  };
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
  codexAuthPath?: string;
  model?: string;
  statefulResponses?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  stop?: string[];
  inputCostPerMillionTokens?: number;
  cachedInputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
  shell?: string;
  timeoutMs?: number;
  transcriptTurns?: number;
  transcriptCompactionMinChars?: number;
  transcriptCompactionHysteresisTurns?: number;
  maxContextChars?: number;
  maxTurns?: number;
  transcriptCompactionChars?: number;
  dangerReview?: DangerReviewMode;
  dangerReviewProfile?: string;
  traceRaw?: boolean;
  readOnly?: boolean;
  providerRetries?: number;
  providerRetryDelayMs?: number;
  providerDebug?: boolean;
  subAgentInheritContext?: boolean;
  remoteSessionTtlDays?: number;
  logDir?: string;
};

type RawConfig = Record<string, unknown>;

const DEFAULT_CONFIG: SmithConfig = {
  defaultProfile: "default",
  benchmark: {},
  profiles: {
    default: {
      adapter: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
      model: "gpt-5.4",
      statefulResponses: false,
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
      statefulResponses: false,
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
    transcriptCompactionMinChars: 24_000,
    transcriptCompactionHysteresisTurns: 10,
    maxContextChars: 120_000,
    maxTurns: 20,
    transcriptCompactionChars: 8_000,
    dangerReview: "llm",
    dangerReviewProfile: "reviewer",
    traceRaw: false,
    readOnly: false,
    providerRetries: 2,
    providerRetryDelayMs: 250,
    providerDebug: false,
    subAgentInheritContext: true,
    remoteSessionTtlDays: 30
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
  const envLogDir = options.env?.SMITH_LOG_DIR ?? process.env.SMITH_LOG_DIR;
  if (!config.runtime.logDir && envLogDir) {
    config.runtime.logDir = envLogDir;
  }

  config.files = files;
  validateConfig(config);
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
    const available = Object.keys(config.profiles).sort().join(", ");
    throw new Error(`unknown profile '${name}'. Available profiles: ${available || "(none)"}`);
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
      case "--codex-auth-path":
        overrides.codexAuthPath = readValue();
        break;
      case "--model":
        overrides.model = readValue();
        break;
      case "--stateful-responses":
        overrides.statefulResponses = true;
        break;
      case "--prompt-cache-key":
        overrides.promptCacheKey = readValue();
        break;
      case "--prompt-cache-retention":
        overrides.promptCacheRetention = parsePromptCacheRetention(readValue());
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
      case "--input-cost-per-million-tokens":
        overrides.inputCostPerMillionTokens = Number(readValue());
        break;
      case "--cached-input-cost-per-million-tokens":
        overrides.cachedInputCostPerMillionTokens = Number(readValue());
        break;
      case "--output-cost-per-million-tokens":
        overrides.outputCostPerMillionTokens = Number(readValue());
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
      case "--transcript-compaction-min-chars":
        overrides.transcriptCompactionMinChars = Number.parseInt(readValue(), 10);
        break;
      case "--transcript-compaction-hysteresis-turns":
        overrides.transcriptCompactionHysteresisTurns = Number.parseInt(readValue(), 10);
        break;
      case "--max-context-chars":
        overrides.maxContextChars = Number.parseInt(readValue(), 10);
        break;
      case "--max-turns":
        overrides.maxTurns = Number.parseInt(readValue(), 10);
        break;
      case "--transcript-compaction-chars":
        overrides.transcriptCompactionChars = Number.parseInt(readValue(), 10);
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
      case "--read-only":
        overrides.readOnly = true;
        break;
      case "--provider-retries":
        overrides.providerRetries = Number.parseInt(readValue(), 10);
        break;
      case "--provider-retry-delay-ms":
        overrides.providerRetryDelayMs = Number.parseInt(readValue(), 10);
        break;
      case "--provider-debug":
        overrides.providerDebug = true;
        break;
      case "--sub-agent-inherit-context":
        overrides.subAgentInheritContext = true;
        break;
      case "--no-sub-agent-inherit-context":
        overrides.subAgentInheritContext = false;
        break;
      case "--provider-message-chain":
        // Legacy no-op: provider message-chain rendering is always enabled.
        break;
      case "--remote-session-ttl-days":
        overrides.remoteSessionTtlDays = Number.parseInt(readValue(), 10);
        break;
      case "--log-dir":
        overrides.logDir = readValue();
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
# Optional estimated pricing in USD per 1,000,000 tokens.
# input_cost_per_million_tokens = 1.25
# cached_input_cost_per_million_tokens = 0.125
# output_cost_per_million_tokens = 10

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
transcript_compaction_min_chars = 24000
transcript_compaction_hysteresis_turns = 10
max_context_chars = 120000
max_turns = 20
transcript_compaction_chars = 8000
danger_review = "llm"
danger_review_profile = "reviewer"
provider_retries = 2
provider_retry_delay_ms = 250
sub_agent_inherit_context = true
remote_session_ttl_days = 30
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
        statefulResponses: false,
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

  if (isObject(raw.benchmark)) {
    next.benchmark = {
      ...next.benchmark,
      ...(typeof raw.benchmark.default_profile === "string"
        ? { defaultProfile: raw.benchmark.default_profile }
        : {})
    };
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
    ...(cli.codexAuthPath ? { codexAuthPath: cli.codexAuthPath } : {}),
    ...(cli.model ? { model: cli.model } : {}),
    ...(cli.statefulResponses !== undefined ? { statefulResponses: cli.statefulResponses } : {}),
    ...(cli.promptCacheKey !== undefined ? { promptCacheKey: cli.promptCacheKey } : {}),
    ...(cli.promptCacheRetention !== undefined ? { promptCacheRetention: cli.promptCacheRetention } : {}),
    ...(cli.temperature !== undefined ? { temperature: cli.temperature } : {}),
    ...(cli.maxOutputTokens !== undefined ? { maxOutputTokens: cli.maxOutputTokens } : {}),
    ...(cli.reasoningEffort ? { reasoningEffort: cli.reasoningEffort } : {}),
    ...(cli.stop ? { stop: cli.stop } : {}),
    ...(cli.inputCostPerMillionTokens !== undefined
      ? { inputCostPerMillionTokens: cli.inputCostPerMillionTokens }
      : {}),
    ...(cli.cachedInputCostPerMillionTokens !== undefined
      ? { cachedInputCostPerMillionTokens: cli.cachedInputCostPerMillionTokens }
      : {}),
    ...(cli.outputCostPerMillionTokens !== undefined
      ? { outputCostPerMillionTokens: cli.outputCostPerMillionTokens }
      : {})
  };

  next.runtime = {
    ...next.runtime,
    ...(cli.shell ? { shell: cli.shell } : {}),
    ...(cli.timeoutMs !== undefined ? { timeoutMs: cli.timeoutMs } : {}),
    ...(cli.transcriptTurns !== undefined ? { transcriptTurns: cli.transcriptTurns } : {}),
    ...(cli.transcriptCompactionMinChars !== undefined
      ? { transcriptCompactionMinChars: cli.transcriptCompactionMinChars }
      : {}),
    ...(cli.transcriptCompactionHysteresisTurns !== undefined
      ? { transcriptCompactionHysteresisTurns: cli.transcriptCompactionHysteresisTurns }
      : {}),
    ...(cli.maxContextChars !== undefined ? { maxContextChars: cli.maxContextChars } : {}),
    ...(cli.maxTurns !== undefined ? { maxTurns: cli.maxTurns } : {}),
    ...(cli.transcriptCompactionChars !== undefined
      ? { transcriptCompactionChars: cli.transcriptCompactionChars }
      : {}),
    ...(cli.dangerReview ? { dangerReview: cli.dangerReview } : {}),
    ...(cli.dangerReviewProfile ? { dangerReviewProfile: cli.dangerReviewProfile } : {}),
    ...(cli.traceRaw !== undefined ? { traceRaw: cli.traceRaw } : {}),
    ...(cli.readOnly !== undefined ? { readOnly: cli.readOnly } : {}),
    ...(cli.providerRetries !== undefined ? { providerRetries: cli.providerRetries } : {}),
    ...(cli.providerRetryDelayMs !== undefined ? { providerRetryDelayMs: cli.providerRetryDelayMs } : {}),
    ...(cli.providerDebug !== undefined ? { providerDebug: cli.providerDebug } : {}),
    ...(cli.subAgentInheritContext !== undefined ? { subAgentInheritContext: cli.subAgentInheritContext } : {}),
    ...(cli.remoteSessionTtlDays !== undefined ? { remoteSessionTtlDays: cli.remoteSessionTtlDays } : {}),
    ...(cli.logDir !== undefined ? { logDir: cli.logDir } : {})
  };

  return next;
}

function mergeProfile(previous: ProfileConfig, raw: RawConfig): ProfileConfig {
  return {
    ...previous,
    ...(raw.adapter ? { adapter: parseAdapter(String(raw.adapter)) } : {}),
    ...(typeof raw.base_url === "string" ? { baseUrl: raw.base_url } : {}),
    ...(typeof raw.api_key_env === "string" ? { apiKeyEnv: raw.api_key_env } : {}),
    ...(typeof raw.codex_auth_path === "string" ? { codexAuthPath: raw.codex_auth_path } : {}),
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(typeof raw.stateful_responses === "boolean" ? { statefulResponses: raw.stateful_responses } : {}),
    ...(typeof raw.prompt_cache_key === "string" ? { promptCacheKey: raw.prompt_cache_key } : {}),
    ...(typeof raw.prompt_cache_retention === "string"
      ? { promptCacheRetention: parsePromptCacheRetention(raw.prompt_cache_retention) }
      : {}),
    ...(typeof raw.temperature === "number" ? { temperature: raw.temperature } : {}),
    ...(typeof raw.max_output_tokens === "number" ? { maxOutputTokens: raw.max_output_tokens } : {}),
    ...(typeof raw.reasoning_effort === "string"
      ? { reasoningEffort: parseReasoningEffort(raw.reasoning_effort) }
      : {}),
    ...(Array.isArray(raw.stop) ? { stop: raw.stop.map(String) } : {}),
    ...(typeof raw.input_cost_per_million_tokens === "number"
      ? { inputCostPerMillionTokens: raw.input_cost_per_million_tokens }
      : {}),
    ...(typeof raw.cached_input_cost_per_million_tokens === "number"
      ? { cachedInputCostPerMillionTokens: raw.cached_input_cost_per_million_tokens }
      : {}),
    ...(typeof raw.output_cost_per_million_tokens === "number"
      ? { outputCostPerMillionTokens: raw.output_cost_per_million_tokens }
      : {}),
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
    ...(typeof raw.transcript_compaction_min_chars === "number"
      ? { transcriptCompactionMinChars: raw.transcript_compaction_min_chars }
      : {}),
    ...(typeof raw.transcript_compaction_hysteresis_turns === "number"
      ? { transcriptCompactionHysteresisTurns: raw.transcript_compaction_hysteresis_turns }
      : {}),
    ...(typeof raw.max_context_chars === "number" ? { maxContextChars: raw.max_context_chars } : {}),
    ...(typeof raw.max_turns === "number" ? { maxTurns: raw.max_turns } : {}),
    ...(typeof raw.transcript_compaction_chars === "number"
      ? { transcriptCompactionChars: raw.transcript_compaction_chars }
      : {}),
    ...(typeof raw.danger_review === "string" ? { dangerReview: parseDangerReview(raw.danger_review) } : {}),
    ...(typeof raw.danger_review_profile === "string" ? { dangerReviewProfile: raw.danger_review_profile } : {}),
    ...(typeof raw.trace_raw === "boolean" ? { traceRaw: raw.trace_raw } : {}),
    ...(typeof raw.read_only === "boolean" ? { readOnly: raw.read_only } : {}),
    ...(typeof raw.provider_retries === "number" ? { providerRetries: raw.provider_retries } : {}),
    ...(typeof raw.provider_retry_delay_ms === "number" ? { providerRetryDelayMs: raw.provider_retry_delay_ms } : {}),
    ...(typeof raw.provider_debug === "boolean" ? { providerDebug: raw.provider_debug } : {}),
    ...(typeof raw.sub_agent_inherit_context === "boolean"
      ? { subAgentInheritContext: raw.sub_agent_inherit_context }
      : {}),
    ...(typeof raw.remote_session_ttl_days === "number" ? { remoteSessionTtlDays: raw.remote_session_ttl_days } : {}),
    ...(typeof raw.log_dir === "string" ? { logDir: raw.log_dir } : {})
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
    value === "chatgpt-codex" ||
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

function parsePromptCacheRetention(value: string): "in_memory" | "24h" {
  if (value === "in_memory" || value === "24h") return value;
  throw new Error(`unknown prompt cache retention '${value}'`);
}

function parseDangerReview(value: string): DangerReviewMode {
  if (value === "off" || value === "ask" || value === "deterministic" || value === "llm") return value;
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
    benchmark: { ...config.benchmark },
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

export function validateConfig(config: SmithConfig): void {
  if (!config.defaultProfile.trim()) throw new Error("default_profile must not be empty");
  if (Object.keys(config.profiles).length === 0) throw new Error("at least one profile is required");
  for (const [name, profile] of Object.entries(config.profiles)) {
    const prefix = `profiles.${name}`;
    if (!profile.model.trim()) throw new Error(`${prefix}.model must not be empty`);
    validateUrl(`${prefix}.base_url`, profile.baseUrl);
    validateRange(`${prefix}.temperature`, profile.temperature, 0, 2);
    validateInteger(`${prefix}.max_output_tokens`, profile.maxOutputTokens, 1, Number.MAX_SAFE_INTEGER);
    validateRange(`${prefix}.input_cost_per_million_tokens`, profile.inputCostPerMillionTokens, 0, Number.MAX_SAFE_INTEGER);
    validateRange(
      `${prefix}.cached_input_cost_per_million_tokens`,
      profile.cachedInputCostPerMillionTokens,
      0,
      Number.MAX_SAFE_INTEGER
    );
    validateRange(`${prefix}.output_cost_per_million_tokens`, profile.outputCostPerMillionTokens, 0, Number.MAX_SAFE_INTEGER);
    if (profile.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.apiKeyEnv)) {
      throw new Error(`${prefix}.api_key_env must be an environment variable name`);
    }
    if (profile.promptCacheKey !== undefined && !profile.promptCacheKey.trim()) {
      throw new Error(`${prefix}.prompt_cache_key must not be empty`);
    }
    if (profile.stop?.some((value) => !value)) throw new Error(`${prefix}.stop must not contain empty values`);
  }
  validateInteger("runtime.timeout_ms", config.runtime.timeoutMs, 1, Number.MAX_SAFE_INTEGER);
  validateInteger("runtime.transcript_turns", config.runtime.transcriptTurns, 1, Number.MAX_SAFE_INTEGER);
  validateInteger("runtime.transcript_compaction_min_chars", config.runtime.transcriptCompactionMinChars, 0, Number.MAX_SAFE_INTEGER);
  validateInteger(
    "runtime.transcript_compaction_hysteresis_turns",
    config.runtime.transcriptCompactionHysteresisTurns,
    0,
    Number.MAX_SAFE_INTEGER
  );
  validateInteger("runtime.max_context_chars", config.runtime.maxContextChars, 1, Number.MAX_SAFE_INTEGER);
  validateInteger("runtime.max_turns", config.runtime.maxTurns, 1, Number.MAX_SAFE_INTEGER);
  validateInteger("runtime.transcript_compaction_chars", config.runtime.transcriptCompactionChars, 0, Number.MAX_SAFE_INTEGER);
  validateInteger("runtime.provider_retries", config.runtime.providerRetries, 0, 10);
  validateInteger("runtime.provider_retry_delay_ms", config.runtime.providerRetryDelayMs, 0, 60_000);
  validateInteger("runtime.remote_session_ttl_days", config.runtime.remoteSessionTtlDays, 1, 3650);
  if (config.runtime.logDir !== undefined && !config.runtime.logDir.trim()) {
    throw new Error("runtime.log_dir must not be empty");
  }
  if (!config.runtime.shell.trim()) throw new Error("runtime.shell must not be empty");
  if (!config.profiles[config.defaultProfile]) {
    throw new Error(`default_profile '${config.defaultProfile}' does not match a configured profile`);
  }
  if (!config.profiles[config.runtime.dangerReviewProfile]) {
    throw new Error(`runtime.danger_review_profile '${config.runtime.dangerReviewProfile}' does not match a configured profile`);
  }
  if (config.benchmark.defaultProfile && !config.profiles[config.benchmark.defaultProfile]) {
    throw new Error(`benchmark.default_profile '${config.benchmark.defaultProfile}' does not match a configured profile`);
  }
}

function validateUrl(name: string, value: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    throw new Error(`${name} must be an http or https URL`);
  }
}

function validateInteger(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function validateRange(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
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
