import type { ProviderAdapter, SmithModelRequest } from "./types.js";
import { authHeaders, isRecord, joinUrl, mergeBody, postJson, requireText, textValue, usageFromOpenAi } from "./types.js";

export const openAiChatAdapter: ProviderAdapter = {
  name: "openai-chat",
  async complete(request, profile, options = {}) {
    const body = mergeBody(buildBody(request), profile, request);
    const raw = await postJson(
      joinUrl(profile.baseUrl, "chat/completions"),
      authHeaders(profile, options.apiKey),
      body,
      options.fetch,
      options.debugLog
    );
    return { text: requireText("openai-chat", extractOpenAiChatText(raw)), raw, usage: isRecord(raw) ? usageFromOpenAi(raw) : undefined };
  }
};

function buildBody(request: SmithModelRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    stream: false,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    ...(request.stop ? { stop: request.stop } : {})
  };
}

export function extractOpenAiChatText(raw: unknown): string {
  if (!isRecord(raw) || !Array.isArray(raw.choices)) return "";
  const first = raw.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return "";
  return textValue(first.message.content) ?? "";
}
