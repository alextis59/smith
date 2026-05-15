import type { ProviderAdapter, SmithModelRequest } from "./types.js";
import { isRecord, joinUrl, mergeBody, numberValue, postJson, textValue } from "./types.js";

export const geminiAdapter: ProviderAdapter = {
  name: "gemini",
  async complete(request, profile, options = {}) {
    const body = mergeBody(buildBody(request), profile, request);
    const headers = {
      ...(options.apiKey ? { "x-goog-api-key": options.apiKey } : {}),
      ...profile.headers
    };
    const raw = await postJson(
      joinUrl(profile.baseUrl, `v1beta/models/${encodeURIComponent(request.model)}:generateContent`),
      headers,
      body,
      options.fetch
    );
    return { text: extractGeminiText(raw), raw, usage: extractUsage(raw) };
  }
};

function buildBody(request: SmithModelRequest): Record<string, unknown> {
  const systemText = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const generationConfig = {
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
    ...(request.stop ? { stopSequences: request.stop } : {})
  };

  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents: request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      })),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {})
  };
}

export function extractGeminiText(raw: unknown): string {
  if (!isRecord(raw) || !Array.isArray(raw.candidates)) return "";
  const first = raw.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return "";
  return first.content.parts
    .map((part) => (isRecord(part) ? textValue(part.text) : undefined))
    .filter((text): text is string => Boolean(text))
    .join("");
}

function extractUsage(raw: unknown) {
  if (!isRecord(raw) || !isRecord(raw.usageMetadata)) return undefined;
  return {
    inputTokens: numberValue(raw.usageMetadata.promptTokenCount),
    outputTokens: numberValue(raw.usageMetadata.candidatesTokenCount),
    totalTokens: numberValue(raw.usageMetadata.totalTokenCount)
  };
}
