import type { ProviderAdapter, SmithModelRequest } from "./types.js";
import { authHeaders, isRecord, joinUrl, mergeBody, postJson, requireText, textValue, usageFromOpenAi } from "./types.js";
import { parseToolArguments, toolCallSummary } from "./tools.js";

export const openAiResponsesAdapter: ProviderAdapter = {
  name: "openai-responses",
  async complete(request, profile, options = {}) {
    const body = mergeBody(buildBody(request), profile, request);
    const raw = await postJson(
      joinUrl(profile.baseUrl, "responses"),
      authHeaders(profile, options.apiKey),
      body,
      options.fetch,
      options.debugLog
    );
    const toolCalls = extractOpenAiResponsesToolCalls(raw);
    const text = extractOpenAiResponsesText(raw);
    return {
      text: toolCalls.length > 0 ? toolCallSummary(toolCalls) : requireText("openai-responses", text),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      raw,
      usage: isRecord(raw) ? usageFromOpenAi(raw) : undefined,
      providerState: responseProviderState(request, raw)
    };
  }
};

function buildBody(request: SmithModelRequest): Record<string, unknown> {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = responseInput(request);
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
    ...(state?.statefulResponses ? { store: true } : {}),
    ...(state?.previousResponseId ? { previous_response_id: state.previousResponseId } : {}),
    ...(state?.promptCacheKey ? { prompt_cache_key: state.promptCacheKey } : {}),
    ...(state?.promptCacheRetention ? { prompt_cache_retention: state.promptCacheRetention } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_output_tokens: request.maxOutputTokens } : {}),
    ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    ...(request.stop ? { stop: request.stop } : {})
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
  return request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content }]
    }));
}

function responseProviderState(request: SmithModelRequest, raw: unknown): SmithModelRequest["providerState"] {
  if (!request.providerState?.statefulResponses || !isRecord(raw)) return undefined;
  const previousResponseId = textValue(raw.id);
  const previousToolCallId = extractOpenAiResponsesToolCalls(raw)[0]?.id;
  return previousResponseId
    ? {
        ...request.providerState,
        previousResponseId,
        previousToolCallId,
        toolOutput: undefined
      }
    : undefined;
}

export function extractOpenAiResponsesText(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const outputText = textValue(raw.output_text);
  if (outputText) return outputText;
  if (!Array.isArray(raw.output)) return "";

  const chunks: string[] = [];
  for (const item of raw.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      const text = textValue(content.text);
      if (text) chunks.push(text);
    }
  }
  return chunks.join("");
}

export function extractOpenAiResponsesToolCalls(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.output)) return [];
  return raw.output
    .map((item): { id?: string; name: string; arguments: Record<string, unknown> } | undefined => {
      if (!isRecord(item) || item.type !== "function_call") return undefined;
      const name = textValue(item.name);
      if (!name) return undefined;
      return {
        id: textValue(item.call_id) ?? textValue(item.id),
        name,
        arguments: parseToolArguments(item.arguments)
      };
    })
    .filter((item): item is { id?: string; name: string; arguments: Record<string, unknown> } => Boolean(item));
}
