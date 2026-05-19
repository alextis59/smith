import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ProfileConfig } from "../config.js";
import type { ProviderAdapter, ProviderCompleteOptions, SmithMessage, SmithModelRequest, SmithModelResponse } from "./types.js";
import { isRecord, joinUrl, numberValue, ProviderError, requireText, textValue } from "./types.js";

type CodexAuthJson = {
  auth_mode?: string;
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
  last_refresh?: unknown;
  [key: string]: unknown;
};

const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_REFRESH_URL = "https://auth.openai.com/oauth/token";

export const chatGptCodexAdapter: ProviderAdapter = {
  name: "chatgpt-codex",
  async complete(request, profile, options = {}) {
    const auth = await loadCodexAuth(profile, options);
    const body = buildBody(request, profile);
    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(auth.accountId ? { "ChatGPT-Account-ID": auth.accountId } : {}),
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      version: "0.130.0",
      ...profile.headers
    };
    options.debugLog?.(
      "provider request",
      JSON.stringify({ url: joinUrl(profile.baseUrl, "responses"), headers: redactHeaders(headers), body }, null, 2)
    );
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(joinUrl(profile.baseUrl, "responses"), {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new ProviderError(`provider request failed: ${errorMessage(error)}`, { transient: true, cause: error });
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw new ProviderError(`provider response stream failed: ${errorMessage(error)}`, {
        transient: true,
        cause: error
      });
    }
    options.debugLog?.("provider response", raw);
    if (!response.ok) {
      throw new ProviderError(`provider request failed (${response.status}): ${raw.trim() || "empty response body"}`, {
        status: response.status,
        transient: response.status === 429 || response.status >= 500
      });
    }
    const parsed = parseResponsesSse(raw);
    return {
      text: requireText("chatgpt-codex", parsed.text),
      raw: parsed.events,
      usage: parsed.usage,
      providerState: responseProviderState(request, parsed.responseId, parsed.toolCallId)
    };
  }
};

function buildBody(request: SmithModelRequest, profile: ProfileConfig): Record<string, unknown> {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = responseInput(request);
  const reasoning = request.reasoningEffort ? { effort: request.reasoningEffort } : undefined;
  const state = request.providerState;

  return {
    model: request.model,
    ...(instructions ? { instructions } : {}),
    input,
    tools: [shellCommandTool()],
    tool_choice: "auto",
    parallel_tool_calls: false,
    ...(reasoning ? { reasoning } : {}),
    store: false,
    ...(state?.previousResponseId ? { previous_response_id: state.previousResponseId } : {}),
    ...(state?.promptCacheKey ? { prompt_cache_key: state.promptCacheKey } : {}),
    ...(state?.promptCacheRetention ? { prompt_cache_retention: state.promptCacheRetention } : {}),
    stream: true,
    include: reasoning ? ["reasoning.encrypted_content"] : [],
    text: { format: { type: "text" } },
    ...profile.body,
    ...request.extra
  };
}

function responseInput(request: SmithModelRequest): Record<string, unknown>[] {
  const state = request.providerState;
  if (state?.previousResponseId && state.previousToolCallId && state.toolOutput !== undefined) {
    return [
      {
        type: "function_call_output",
        call_id: state.previousToolCallId,
        output: state.toolOutput
      }
    ];
  }
  return request.messages.filter((message) => message.role !== "system").map(toResponseInputMessage);
}

function responseProviderState(
  request: SmithModelRequest,
  previousResponseId: string | undefined,
  previousToolCallId: string | undefined
): SmithModelRequest["providerState"] {
  if (!request.providerState?.statefulResponses || !previousResponseId) return undefined;
  return {
    ...request.providerState,
    previousResponseId,
    previousToolCallId,
    toolOutput: undefined
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellCommandTool(): Record<string, unknown> {
  return {
    type: "function",
    name: "shell_command",
    description: [
      "Runs a shell command and returns its output.",
      "Use this to inspect files, edit files, and run tests.",
      "Always set the workdir param. Do not use cd unless absolutely necessary."
    ].join("\n"),
    strict: false,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell script to execute in the user's default shell"
        },
        workdir: {
          type: "string",
          description: "The working directory to execute the command in"
        },
        timeout_ms: {
          type: "number",
          description: "The timeout for the command in milliseconds"
        }
      },
      required: ["command"],
      additionalProperties: false
    }
  };
}

function toResponseInputMessage(message: SmithMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content
      }
    ]
  };
}

export function parseResponsesSse(raw: string): {
  text: string;
  events: unknown[];
  usage?: SmithModelResponse["usage"];
  responseId?: string;
  toolCallId?: string;
} {
  const events: unknown[] = [];
  const chunks: string[] = [];
  const functionCalls = new Map<string, { name?: string; arguments: string; callId?: string }>();
  let doneText: string | undefined;
  let usage: SmithModelResponse["usage"] | undefined;
  let responseId: string | undefined;

  for (const block of raw.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    if (data === "[DONE]") continue;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    events.push(event);
    if (!isRecord(event)) continue;
    const itemId = textValue(event.item_id);
    if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
      captureFunctionCall(functionCalls, event.item);
    } else if (event.type === "response.function_call_arguments.delta" && itemId) {
      const call = functionCalls.get(itemId) ?? { arguments: "" };
      call.arguments += textValue(event.delta) ?? "";
      functionCalls.set(itemId, call);
    } else if (event.type === "response.function_call_arguments.done" && itemId) {
      const call = functionCalls.get(itemId) ?? { arguments: "" };
      call.arguments = textValue(event.arguments) ?? call.arguments;
      functionCalls.set(itemId, call);
    } else if (event.type === "response.output_text.delta") {
      const delta = textValue(event.delta);
      if (delta) chunks.push(delta);
    } else if (event.type === "response.output_text.done") {
      const text = textValue(event.text);
      if (text && text.trim().length > 0) doneText = text;
    } else if (event.type === "response.completed" && isRecord(event.response)) {
      responseId = textValue(event.response.id) ?? responseId;
      usage = usageFromResponse(event.response);
      const completedText = extractCompletedResponseText(event.response);
      if (!doneText && completedText && completedText.trim().length > 0) doneText = completedText;
    }
  }

  const shellCommand = extractShellCommand(functionCalls);
  return {
    text: shellCommand?.command ?? doneText ?? chunks.join(""),
    events,
    usage,
    responseId,
    toolCallId: shellCommand?.callId
  };
}

function captureFunctionCall(calls: Map<string, { name?: string; arguments: string; callId?: string }>, item: unknown): void {
  if (!isRecord(item) || item.type !== "function_call") return;
  const id = textValue(item.id) ?? textValue(item.call_id);
  if (!id) return;
  calls.set(id, {
    name: textValue(item.name),
    callId: textValue(item.call_id) ?? id,
    arguments: textValue(item.arguments) ?? calls.get(id)?.arguments ?? ""
  });
}

function extractShellCommand(
  calls: Map<string, { name?: string; arguments: string; callId?: string }>
): { command: string; callId?: string } | undefined {
  for (const call of calls.values()) {
    if (call.name !== "shell_command") continue;
    const command = shellCommandFromArguments(call.arguments);
    if (command && command.trim().length > 0) return { command, callId: call.callId };
  }
  return undefined;
}

function shellCommandFromArguments(args: string): string | undefined {
  try {
    const parsed = JSON.parse(args) as unknown;
    if (isRecord(parsed)) return textValue(parsed.command);
  } catch {
    return undefined;
  }
  return undefined;
}

function extractCompletedResponseText(response: Record<string, unknown>): string | undefined {
  if (!Array.isArray(response.output)) return undefined;
  const chunks: string[] = [];
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      const text = textValue(content.text);
      if (text) chunks.push(text);
    }
  }
  return chunks.length > 0 ? chunks.join("") : undefined;
}

function usageFromResponse(response: Record<string, unknown>): SmithModelResponse["usage"] | undefined {
  if (!isRecord(response.usage)) return undefined;
  const inputDetails = isRecord(response.usage.input_tokens_details) ? response.usage.input_tokens_details : undefined;
  const outputDetails = isRecord(response.usage.output_tokens_details) ? response.usage.output_tokens_details : undefined;
  return {
    inputTokens: numberValue(response.usage.input_tokens),
    cachedInputTokens: numberValue(inputDetails?.cached_tokens),
    outputTokens: numberValue(response.usage.output_tokens),
    reasoningOutputTokens: numberValue(outputDetails?.reasoning_tokens),
    totalTokens: numberValue(response.usage.total_tokens)
  };
}

async function loadCodexAuth(
  profile: ProfileConfig,
  options: ProviderCompleteOptions
): Promise<{ accessToken: string; accountId?: string }> {
  const authPath = resolveCodexAuthPath(profile);
  const auth = readCodexAuth(authPath);
  if (tokenNeedsRefresh(auth.tokens?.access_token)) {
    await refreshCodexAuth(authPath, auth, options);
  }
  const refreshed = readCodexAuth(authPath);
  const accessToken = stringValue(refreshed.tokens?.access_token);
  if (!accessToken) throw new ProviderError(`Codex auth file does not contain a ChatGPT access token: ${authPath}`);
  return {
    accessToken,
    accountId: stringValue(refreshed.tokens?.account_id)
  };
}

function resolveCodexAuthPath(profile: ProfileConfig): string {
  if (profile.codexAuthPath) return resolve(profile.codexAuthPath);
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(codexHome, "auth.json");
}

function readCodexAuth(path: string): CodexAuthJson {
  if (!existsSync(path)) throw new ProviderError(`Codex auth file not found: ${path}. Run 'codex login' first.`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CodexAuthJson;
  } catch (error) {
    throw new ProviderError(`failed to read Codex auth file: ${path}`, { cause: error });
  }
}

async function refreshCodexAuth(path: string, auth: CodexAuthJson, options: ProviderCompleteOptions): Promise<void> {
  const refreshToken = stringValue(auth.tokens?.refresh_token);
  if (!refreshToken) throw new ProviderError("Codex ChatGPT access token is expired and no refresh token is available.");
  const refreshUrl = process.env.CODEX_REFRESH_TOKEN_URL_OVERRIDE || DEFAULT_REFRESH_URL;
  const response = await (options.fetch ?? fetch)(refreshUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CODEX_OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new ProviderError(`Codex ChatGPT token refresh failed (${response.status}): ${raw.trim() || "empty response body"}`, {
      status: response.status,
      transient: response.status >= 500
    });
  }
  let refreshed: Record<string, unknown>;
  try {
    refreshed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new ProviderError("Codex ChatGPT token refresh returned invalid JSON", { cause: error });
  }
  const next = {
    ...auth,
    tokens: {
      ...auth.tokens,
      ...(typeof refreshed.id_token === "string" ? { id_token: refreshed.id_token } : {}),
      ...(typeof refreshed.access_token === "string" ? { access_token: refreshed.access_token } : {}),
      ...(typeof refreshed.refresh_token === "string" ? { refresh_token: refreshed.refresh_token } : {})
    },
    last_refresh: new Date().toISOString()
  };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function tokenNeedsRefresh(token: unknown): boolean {
  if (typeof token !== "string") return true;
  const exp = jwtExpiryMs(token);
  if (exp === undefined) return false;
  return exp - Date.now() < 60_000;
}

function jwtExpiryMs(token: string): number | undefined {
  const [, payload] = token.split(".");
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const exp = numberValue(parsed.exp);
    return exp === undefined ? undefined : exp * 1000;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|token|key/i.test(key) ? redactSecret(value) : value
    ])
  );
}

function redactSecret(value: string): string {
  return value.length <= 12 ? "(redacted)" : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
