import type { ProviderAdapter, SmithModelRequest } from "./types.js";
import { authHeaders, isRecord, joinUrl, mergeBody, postJson, textValue, usageFromOpenAi } from "./types.js";

export const openAiResponsesAdapter: ProviderAdapter = {
  name: "openai-responses",
  async complete(request, profile, options = {}) {
    const body = mergeBody(buildBody(request), profile, request);
    const raw = await postJson(
      joinUrl(profile.baseUrl, "responses"),
      authHeaders(profile, options.apiKey),
      body,
      options.fetch
    );
    return { text: extractOpenAiResponsesText(raw), raw, usage: isRecord(raw) ? usageFromOpenAi(raw) : undefined };
  }
};

function buildBody(request: SmithModelRequest): Record<string, unknown> {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

  return {
    model: request.model,
    ...(instructions ? { instructions } : {}),
    input,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_output_tokens: request.maxOutputTokens } : {}),
    ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
    ...(request.stop ? { stop: request.stop } : {})
  };
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
