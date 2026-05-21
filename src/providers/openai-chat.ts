import type { ProviderAdapter, SmithModelRequest } from "./types.js";
import { authHeaders, isRecord, joinUrl, mergeBody, postJson, requireText, textValue, usageFromOpenAi } from "./types.js";
import { parseToolArguments, toolCallSummary } from "./tools.js";

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
    const toolCalls = extractOpenAiChatToolCalls(raw);
    const text = extractOpenAiChatText(raw);
    return {
      text: toolCalls.length > 0 ? toolCallSummary(toolCalls) : requireText("openai-chat", text),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      raw,
      usage: isRecord(raw) ? usageFromOpenAi(raw) : undefined
    };
  }
};

function buildBody(request: SmithModelRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    stream: false,
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false
            }
          })),
          tool_choice: "required",
          parallel_tool_calls: false
        }
      : {}),
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

export function extractOpenAiChatToolCalls(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.choices)) return [];
  const first = raw.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || !Array.isArray(first.message.tool_calls)) return [];
  return first.message.tool_calls
    .map((item): { id?: string; name: string; arguments: Record<string, unknown> } | undefined => {
      if (!isRecord(item) || !isRecord(item.function)) return undefined;
      const name = textValue(item.function.name);
      if (!name) return undefined;
      return {
        id: textValue(item.id),
        name,
        arguments: parseToolArguments(item.function.arguments)
      };
    })
    .filter((item): item is { id?: string; name: string; arguments: Record<string, unknown> } => Boolean(item));
}
