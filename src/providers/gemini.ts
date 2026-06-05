import type { ProviderAdapter, SmithMessage, SmithModelRequest } from "./types.js";
import { isRecord, joinUrl, mergeBody, numberValue, postJson, requireText, textValue } from "./types.js";
import { parseToolArguments, toolCallSummary } from "./tools.js";

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
      options.fetch,
      options.debugLog
    );
    const toolCalls = extractGeminiToolCalls(raw);
    const text = extractGeminiText(raw);
    return {
      text: toolCalls.length > 0 ? toolCallSummary(toolCalls) : requireText("gemini", text),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      raw,
      usage: extractUsage(raw)
    };
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
    contents: mergeAdjacentContents(request.messages.filter((message) => message.role !== "system")),
    ...(request.tools && request.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: toGeminiSchema(tool.parameters)
              }))
            }
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: request.tools.map((tool) => tool.name)
            }
          }
        }
      : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {})
  };
}

function mergeAdjacentContents(messages: SmithMessage[]): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  const merged: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const last = merged.at(-1);
    if (last?.role === role) {
      last.parts[0].text = `${last.parts[0].text}\n\n${message.content}`;
    } else {
      merged.push({ role, parts: [{ text: message.content }] });
    }
  }
  return merged;
}

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "additionalProperties")
      .map(([key, item]) => [key, toGeminiSchema(item)])
  );
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

export function extractGeminiToolCalls(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.candidates)) return [];
  const first = raw.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return [];
  return first.content.parts
    .map((part): { id?: string; name: string; arguments: Record<string, unknown> } | undefined => {
      if (!isRecord(part) || !isRecord(part.functionCall)) return undefined;
      const name = textValue(part.functionCall.name);
      if (!name) return undefined;
      return {
        name,
        arguments: parseToolArguments(part.functionCall.args)
      };
    })
    .filter((item): item is { id?: string; name: string; arguments: Record<string, unknown> } => Boolean(item));
}

function extractUsage(raw: unknown) {
  if (!isRecord(raw) || !isRecord(raw.usageMetadata)) return undefined;
  return {
    inputTokens: numberValue(raw.usageMetadata.promptTokenCount),
    outputTokens: numberValue(raw.usageMetadata.candidatesTokenCount),
    totalTokens: numberValue(raw.usageMetadata.totalTokenCount)
  };
}
