import type { ProfileConfig } from "../config.js";

export type SmithMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type SmithModelRequest = {
  messages: SmithMessage[];
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  stop?: string[];
  extra?: Record<string, unknown>;
};

export type SmithModelResponse = {
  text: string;
  raw: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export type ProviderFetch = typeof fetch;

export type ProviderAdapter = {
  name: ProfileConfig["adapter"];
  complete(
    request: SmithModelRequest,
    profile: ProfileConfig,
    options?: { fetch?: ProviderFetch; apiKey?: string }
  ): Promise<SmithModelResponse>;
};

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
  fetchImpl: ProviderFetch = fetch
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider request failed ${response.status}: ${text}`);
  }
  return response.json();
}

export function usageFromOpenAi(raw: Record<string, unknown>): SmithModelResponse["usage"] {
  const usage = raw.usage;
  if (!isRecord(usage)) return undefined;
  return {
    inputTokens: numberValue(usage.prompt_tokens) ?? numberValue(usage.input_tokens),
    outputTokens: numberValue(usage.completion_tokens) ?? numberValue(usage.output_tokens),
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
