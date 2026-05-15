import type { ProfileConfig } from "../config.js";
import { resolveApiKey } from "../config.js";
import { anthropicMessagesAdapter } from "./anthropic-messages.js";
import { geminiAdapter } from "./gemini.js";
import { openAiChatAdapter } from "./openai-chat.js";
import { openAiResponsesAdapter } from "./openai-responses.js";
import type { ProviderAdapter, ProviderFetch, SmithModelRequest, SmithModelResponse } from "./types.js";

const adapters: Record<ProfileConfig["adapter"], ProviderAdapter> = {
  "openai-chat": openAiChatAdapter,
  "openai-responses": openAiResponsesAdapter,
  gemini: geminiAdapter,
  "anthropic-messages": anthropicMessagesAdapter
};

export function getAdapter(name: ProfileConfig["adapter"]): ProviderAdapter {
  return adapters[name];
}

export async function completeWithProfile(
  request: SmithModelRequest,
  profile: ProfileConfig,
  options: { env?: NodeJS.ProcessEnv; fetch?: ProviderFetch } = {}
): Promise<SmithModelResponse> {
  return getAdapter(profile.adapter).complete(
    {
      ...request,
      model: request.model || profile.model,
      temperature: request.temperature ?? profile.temperature,
      maxOutputTokens: request.maxOutputTokens ?? profile.maxOutputTokens,
      reasoningEffort: request.reasoningEffort ?? profile.reasoningEffort,
      stop: request.stop ?? profile.stop
    },
    profile,
    { apiKey: resolveApiKey(profile, options.env), fetch: options.fetch }
  );
}

export type { ProviderAdapter, ProviderFetch, SmithMessage, SmithModelRequest, SmithModelResponse } from "./types.js";
