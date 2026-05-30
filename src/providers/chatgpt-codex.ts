import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProfileConfig } from "../config.js";
import type { ProviderAdapter, ProviderCompleteOptions, SmithMessage, SmithModelRequest, SmithModelResponse, SmithToolCall } from "./types.js";
import { isRecord, joinUrl, numberValue, ProviderError, requireText, textValue } from "./types.js";
import { OMITTED_PATCH_BODY_PLACEHOLDER, parseToolArguments, toolCallSummary } from "./tools.js";

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
    const authPath = resolveCodexAuthPath(profile);
    const auth = await loadCodexAuth(authPath, options);
    const installationId = loadCodexInstallationId(authPath);
    const body = buildBody(request, profile);
    if (installationId) {
      body.client_metadata = {
        ...(isRecord(body.client_metadata) ? body.client_metadata : {}),
        "x-codex-installation-id": installationId
      };
    }
    const codexIdentityHeaders = codexSessionHeaders(request.providerState);
    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(auth.accountId ? { "ChatGPT-Account-ID": auth.accountId } : {}),
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      version: "0.131.0",
      ...codexIdentityHeaders,
      ...profile.headers
    };
    const url = joinUrl(profile.baseUrl, "responses");
    const requestBodyJson = JSON.stringify(body);
    options.debugLog?.(
      "provider request",
      JSON.stringify({ url, headers: redactHeaders(headers), body }, null, 2)
    );
    options.debugJson?.({
      adapter: "chatgpt-codex",
      direction: "request",
      method: "POST",
      url,
      headers: redactHeaders(headers),
      body,
      body_json: requestBodyJson
    });
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers,
        body: requestBodyJson
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
    options.debugLog?.("provider response", traceResponsesSse(raw));
    const responseHeaders = Object.fromEntries(response.headers.entries());
    options.debugJson?.({
      adapter: "chatgpt-codex",
      direction: "response",
      method: "POST",
      url,
      status: response.status,
      ok: response.ok,
      headers: responseHeaders,
      raw_sse: raw,
      events: response.ok ? parseResponsesSse(raw).events : undefined,
      error_json: response.ok ? undefined : parseJson(raw)
    });
    if (!response.ok) {
      throw new ProviderError(`provider request failed (${response.status}): ${raw.trim() || "empty response body"}`, {
        status: response.status,
        transient: response.status === 429 || response.status >= 500
      });
    }
    const parsed = parseResponsesSse(raw);
    return {
      text: parsed.toolCalls.length > 0 ? toolCallSummary(parsed.toolCalls) : requireText("chatgpt-codex", parsed.text),
      ...(parsed.toolCalls.length > 0 ? { toolCalls: parsed.toolCalls } : {}),
      raw: parsed.events,
      usage: parsed.usage,
      providerState: responseProviderState(request, inputFromBody(body), parsed, responseHeaders)
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
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false
          })),
          tool_choice: "required",
          parallel_tool_calls: false
        }
      : {}),
    ...(reasoning ? { reasoning } : {}),
    store: false,
    ...(state?.promptCacheKey ? { prompt_cache_key: state.promptCacheKey } : {}),
    ...(state?.promptCacheRetention ? { prompt_cache_retention: state.promptCacheRetention } : {}),
    stream: true,
    include: reasoning ? ["reasoning.encrypted_content"] : [],
    text: { format: { type: "text" } },
    ...profile.body,
    ...request.extra
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function responseInput(request: SmithModelRequest): Record<string, unknown>[] {
  const state = request.providerState;
  if (state?.responsesInputItems) return state.responsesInputItems;
  return request.messages.filter((message) => message.role !== "system").map(toResponseInputMessage);
}

function responseProviderState(
  request: SmithModelRequest,
  input: Record<string, unknown>[],
  parsed: ReturnType<typeof parseResponsesSse>,
  headers: Record<string, string>
): SmithModelRequest["providerState"] {
  if (!request.providerState) return undefined;
  return {
    ...request.providerState,
    previousResponseId: parsed.responseId,
    previousToolCallId: parsed.toolCalls[0]?.id,
    toolOutput: undefined,
    responsesInputItems: [...input, ...parsed.outputItems],
    codexTurnState: headerValue(headers, "x-codex-turn-state") ?? request.providerState.codexTurnState
  };
}

function inputFromBody(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.input) ? (body.input.filter(isRecord) as Record<string, unknown>[]) : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toResponseInputMessage(message: SmithMessage): Record<string, unknown> {
  return {
    type: "message",
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
  outputItems: Record<string, unknown>[];
  toolCalls: SmithToolCall[];
  usage?: SmithModelResponse["usage"];
  responseId?: string;
} {
  const events: unknown[] = [];
  const outputItems: Record<string, unknown>[] = [];
  const pendingOutputItems = new Map<string, Record<string, unknown>>();
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
      if (isRecord(event.item) && shouldPreserveResponseInputItem(event.item)) {
        const key = responseItemKey(event.item, itemId ?? `item_${pendingOutputItems.size}`);
        if (event.type === "response.output_item.done") {
          outputItems.push(compactPreservedResponseInputItem(event.item));
          pendingOutputItems.delete(key);
        } else {
          pendingOutputItems.set(key, { ...event.item });
        }
      }
    } else if (event.type === "response.function_call_arguments.delta" && itemId) {
      const call = functionCalls.get(itemId) ?? { arguments: "" };
      call.arguments += textValue(event.delta) ?? "";
      functionCalls.set(itemId, call);
      appendPendingFunctionCallArguments(pendingOutputItems, itemId, textValue(event.delta) ?? "");
    } else if (event.type === "response.function_call_arguments.done" && itemId) {
      const call = functionCalls.get(itemId) ?? { arguments: "" };
      call.arguments = textValue(event.arguments) ?? call.arguments;
      functionCalls.set(itemId, call);
      setPendingFunctionCallArguments(pendingOutputItems, itemId, call.arguments);
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

  const toolCalls = extractToolCalls(functionCalls);
  outputItems.push(...Array.from(pendingOutputItems.values()).map(compactPreservedResponseInputItem));
  if (outputItems.length === 0) {
    const text = doneText ?? chunks.join("");
    if (text.trim().length > 0) outputItems.push(assistantOutputMessage(text));
  }
  return {
    text: doneText ?? chunks.join(""),
    events,
    outputItems,
    toolCalls,
    usage,
    responseId
  };
}

function shouldPreserveResponseInputItem(item: Record<string, unknown>): boolean {
  const type = textValue(item.type);
  return type === "message" || type === "function_call";
}

function compactPreservedResponseInputItem(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type !== "function_call" || textValue(item.name) !== "patch") return item;
  const args = parseToolArguments(item.arguments);
  return {
    ...item,
    arguments: JSON.stringify({
      ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
      patch: OMITTED_PATCH_BODY_PLACEHOLDER
    })
  };
}

function traceResponsesSse(raw: string): string {
  const kept: string[] = [];
  let omitted = 0;
  for (const block of raw.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    if (isResponsesSseDeltaBlock(block)) {
      omitted += 1;
      continue;
    }
    kept.push(block);
  }
  const note = omitted > 0 ? `# omitted ${omitted} streaming delta event${omitted === 1 ? "" : "s"}` : "";
  return [...kept, note].filter(Boolean).join("\n\n");
}

function isResponsesSseDeltaBlock(block: string): boolean {
  const eventType = block
    .split(/\r?\n/)
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  if (eventType?.endsWith(".delta")) return true;

  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return false;
  const parsed = parseJson(data);
  return isRecord(parsed) && textValue(parsed.type)?.endsWith(".delta") === true;
}

function responseItemKey(item: Record<string, unknown>, fallback: string): string {
  return textValue(item.id) ?? textValue(item.call_id) ?? fallback;
}

function appendPendingFunctionCallArguments(
  items: Map<string, Record<string, unknown>>,
  itemId: string,
  delta: string
): void {
  const item = items.get(itemId);
  if (!item || item.type !== "function_call") return;
  item.arguments = `${textValue(item.arguments) ?? ""}${delta}`;
}

function setPendingFunctionCallArguments(
  items: Map<string, Record<string, unknown>>,
  itemId: string,
  args: string
): void {
  const item = items.get(itemId);
  if (!item || item.type !== "function_call") return;
  item.arguments = args;
}

function assistantOutputMessage(text: string): Record<string, unknown> {
  return {
    type: "message",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text
      }
    ]
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

function extractToolCalls(calls: Map<string, { name?: string; arguments: string; callId?: string }>): SmithToolCall[] {
  return [...calls.values()]
    .map((call): SmithToolCall | undefined => {
      if (!call.name) return undefined;
      return {
        id: call.callId,
        name: call.name,
        arguments: parseToolArguments(call.arguments)
      };
    })
    .filter((call): call is SmithToolCall => Boolean(call));
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

function codexSessionHeaders(state: SmithModelRequest["providerState"]): Record<string, string> {
  const threadId = state?.promptCacheKey;
  if (!threadId) return {};
  return {
    "x-client-request-id": threadId,
    "session-id": threadId,
    "thread-id": threadId,
    ...(state.codexTurnState ? { "x-codex-turn-state": state.codexTurnState } : {})
  };
}

async function loadCodexAuth(
  authPath: string,
  options: ProviderCompleteOptions
): Promise<{ accessToken: string; accountId?: string }> {
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

function loadCodexInstallationId(authPath: string): string | undefined {
  const installationPath = join(dirname(authPath), "installation_id");
  if (!existsSync(installationPath)) return undefined;
  const installationId = readFileSync(installationPath, "utf8").trim();
  return installationId.length > 0 ? installationId : undefined;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lowered = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowered) return value;
  }
  return undefined;
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
