import type { ProfileConfig } from "../config.js";

export type SmithMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type SmithToolName = "run" | "patch" | "sub_agent" | "finish";

export type SmithToolDefinition = {
  name: SmithToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type SmithToolCall = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type SmithModelRequest = {
  messages: SmithMessage[];
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  stop?: string[];
  extra?: Record<string, unknown>;
  providerState?: SmithProviderState;
  tools?: SmithToolDefinition[];
};

export type SmithProviderState = {
  statefulResponses?: boolean;
  previousResponseId?: string;
  previousToolCallId?: string;
  toolOutput?: string;
  promptCacheKey?: string;
  promptCacheRetention?: "in_memory" | "24h";
  responsesInputItems?: Record<string, unknown>[];
  codexTurnState?: string;
};

export type SmithModelResponse = {
  text: string;
  toolCalls?: SmithToolCall[];
  raw: unknown;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    reasoningOutputTokens?: number;
    totalTokens?: number;
  };
  providerState?: SmithProviderState;
};

export type ProviderFetch = typeof fetch;

export type ProviderDebugLog = (section: string, content: string) => void;
export type ProviderDebugJsonLog = (record: Record<string, unknown>) => void;

export type ProviderCompleteOptions = {
  fetch?: ProviderFetch;
  apiKey?: string;
  debugLog?: ProviderDebugLog;
  debugJson?: ProviderDebugJsonLog;
};

export type ProviderAdapter = {
  name: ProfileConfig["adapter"];
  complete(
    request: SmithModelRequest,
    profile: ProfileConfig,
    options?: ProviderCompleteOptions
  ): Promise<SmithModelResponse>;
};

export class ProviderError extends Error {
  readonly status?: number;
  readonly transient: boolean;

  constructor(message: string, options: { status?: number; transient?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.status = options.status;
    this.transient = options.transient ?? false;
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function mergeBody(
  body: Record<string, unknown>,
  profile: ProfileConfig,
  request: SmithModelRequest
): Record<string, unknown> {
  return { ...body, ...profile.body, ...(request.extra ?? {}) };
}

export function authHeaders(profile: ProfileConfig, apiKey: string | undefined): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...profile.headers
  };
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  fetchImpl: ProviderFetch = fetch,
  debugLog?: ProviderDebugLog
): Promise<unknown> {
  const requestHeaders = {
    "Content-Type": "application/json",
    ...headers
  };
  debugLog?.("provider request", JSON.stringify({ url, headers: redactHeaders(requestHeaders), body }, null, 2));

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new ProviderError(`provider request failed: ${errorMessage(error)}`, { transient: true, cause: error });
  }

  if (!response.ok) {
    const text = await response.text();
    const message = normalizeProviderError(response.status, text);
    throw new ProviderError(message, { status: response.status, transient: isTransientStatus(response.status) });
  }
  try {
    const raw = await response.json();
    debugLog?.("provider response", JSON.stringify(raw, null, 2));
    return raw;
  } catch (error) {
    throw new ProviderError(`provider returned invalid JSON: ${errorMessage(error)}`, { cause: error });
  }
}

export function usageFromOpenAi(raw: Record<string, unknown>): SmithModelResponse["usage"] {
  const usage = raw.usage;
  if (!isRecord(usage)) return undefined;
  const inputDetails = isRecord(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : isRecord(usage.input_tokens_details)
      ? usage.input_tokens_details
      : undefined;
  const outputDetails = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : isRecord(usage.output_tokens_details)
      ? usage.output_tokens_details
      : undefined;
  return {
    inputTokens: numberValue(usage.prompt_tokens) ?? numberValue(usage.input_tokens),
    cachedInputTokens: numberValue(inputDetails?.cached_tokens),
    outputTokens: numberValue(usage.completion_tokens) ?? numberValue(usage.output_tokens),
    reasoningOutputTokens: numberValue(outputDetails?.reasoning_tokens),
    totalTokens: numberValue(usage.total_tokens)
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function requireText(adapter: string, text: string): string {
  if (text.trim().length === 0) throw new ProviderError(`${adapter} response did not contain assistant text`);
  return text;
}

function normalizeProviderError(status: number, text: string): string {
  const body = parseErrorBody(text);
  const detail = body || text.trim() || "empty response body";
  return `provider request failed (${status}${isTransientStatus(status) ? ", retryable" : ""}): ${detail}`;
}

function parseErrorBody(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) return undefined;
    const error = parsed.error;
    if (typeof error === "string") return error;
    if (isRecord(error)) {
      return textValue(error.message) ?? textValue(error.type) ?? JSON.stringify(error);
    }
    return textValue(parsed.message);
  } catch {
    return undefined;
  }
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const lowered = key.toLowerCase();
      const redacted =
        lowered === "authorization" || lowered === "x-api-key" || lowered === "x-goog-api-key";
      return [key, redacted ? "[redacted]" : value];
    })
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
