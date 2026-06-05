import type { ProviderAdapter, SmithMessage, SmithModelRequest } from "./types.js";
import { isRecord, joinUrl, mergeBody, numberValue, postJson, requireText, textValue } from "./types.js";
import { parseToolArguments, toolCallSummary } from "./tools.js";

export const anthropicMessagesAdapter: ProviderAdapter = {
  name: "anthropic-messages",
  async complete(request, profile, options = {}) {
    const body = mergeBody(buildBody(request), profile, request);
    const headers = {
      ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
      "anthropic-version": "2023-06-01",
      ...profile.headers
    };
    const raw = await postJson(joinUrl(profile.baseUrl, "v1/messages"), headers, body, options.fetch, options.debugLog);
    const toolCalls = extractAnthropicToolCalls(raw);
    const text = extractAnthropicMessagesText(raw);
    return {
      text: toolCalls.length > 0 ? toolCallSummary(toolCalls) : requireText("anthropic-messages", text),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      raw,
      usage: extractUsage(raw)
    };
  }
};

function buildBody(request: SmithModelRequest): Record<string, unknown> {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  return {
    model: request.model,
    ...(system ? { system } : {}),
    messages: mergeAdjacentMessages(request.messages.filter((message) => message.role !== "system")),
    max_tokens: request.maxOutputTokens ?? 4096,
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
          })),
          tool_choice: { type: "any" }
        }
      : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.stop ? { stop_sequences: request.stop } : {})
  };
}

function mergeAdjacentMessages(messages: SmithMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const merged: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const last = merged.at(-1);
    if (last?.role === role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      merged.push({ role, content: message.content });
    }
  }
  return merged;
}

export function extractAnthropicMessagesText(raw: unknown): string {
  if (!isRecord(raw) || !Array.isArray(raw.content)) return "";
  return raw.content
    .map((item) => (isRecord(item) ? textValue(item.text) : undefined))
    .filter((text): text is string => Boolean(text))
    .join("\n");
}

export function extractAnthropicToolCalls(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.content)) return [];
  return raw.content
    .map((item): { id?: string; name: string; arguments: Record<string, unknown> } | undefined => {
      if (!isRecord(item) || item.type !== "tool_use") return undefined;
      const name = textValue(item.name);
      if (!name) return undefined;
      return {
        id: textValue(item.id),
        name,
        arguments: parseToolArguments(item.input)
      };
    })
    .filter((item): item is { id?: string; name: string; arguments: Record<string, unknown> } => Boolean(item));
}

function extractUsage(raw: unknown) {
  if (!isRecord(raw) || !isRecord(raw.usage)) return undefined;
  return {
    inputTokens: numberValue(raw.usage.input_tokens),
    outputTokens: numberValue(raw.usage.output_tokens)
  };
}
