import type { ProfileConfig } from "../config.js";
import { resolveApiKey } from "../config.js";
import { anthropicMessagesAdapter } from "./anthropic-messages.js";
import { chatGptCodexAdapter } from "./chatgpt-codex.js";
import { geminiAdapter } from "./gemini.js";
import { openAiChatAdapter } from "./openai-chat.js";
import { openAiResponsesAdapter } from "./openai-responses.js";
import { ProviderError } from "./types.js";
import type {
  ProviderAdapter,
  ProviderDebugJsonLog,
  ProviderDebugLog,
  ProviderFetch,
  SmithModelRequest,
  SmithModelResponse
} from "./types.js";

const adapters: Record<ProfileConfig["adapter"], ProviderAdapter> = {
  "openai-chat": openAiChatAdapter,
  "openai-responses": openAiResponsesAdapter,
  "chatgpt-codex": chatGptCodexAdapter,
  gemini: geminiAdapter,
  "anthropic-messages": anthropicMessagesAdapter
};

export function getAdapter(name: ProfileConfig["adapter"]): ProviderAdapter {
  return adapters[name];
}

export async function completeWithProfile(
  request: SmithModelRequest,
  profile: ProfileConfig,
  options: {
    env?: NodeJS.ProcessEnv;
    fetch?: ProviderFetch;
    retries?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    debugLog?: ProviderDebugLog;
    debugJson?: ProviderDebugJsonLog;
  } = {}
): Promise<SmithModelResponse> {
  const normalizedRequest = {
    ...request,
    model: request.model || profile.model,
    temperature: request.temperature ?? profile.temperature,
    maxOutputTokens: request.maxOutputTokens ?? profile.maxOutputTokens,
    reasoningEffort: request.reasoningEffort ?? profile.reasoningEffort,
    stop: request.stop ?? profile.stop
  };
  const attempts = Math.max(1, (options.retries ?? 0) + 1);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) options.debugLog?.("provider retry", `attempt: ${attempt}\nmax_attempts: ${attempts}`);
      const abortController = options.timeoutMs && options.timeoutMs > 0 ? new AbortController() : undefined;
      return await completeAttemptWithTimeout(
        () =>
          getAdapter(profile.adapter).complete(normalizedRequest, profile, {
            apiKey: resolveApiKey(profile, options.env),
            fetch: abortController
              ? fetchWithAbort(options.fetch ?? fetch, abortController.signal)
              : options.fetch,
            debugLog: options.debugLog,
            debugJson: options.debugJson
          }),
        options.timeoutMs,
        abortController
      );
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) break;
      await sleep((options.retryDelayMs ?? 250) * attempt);
    }
  }
  throw lastError;
}

export { ProviderError } from "./types.js";
export type { ProviderAdapter, ProviderFetch, SmithMessage, SmithModelRequest, SmithModelResponse } from "./types.js";

function completeAttemptWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number | undefined,
  abortController: AbortController | undefined
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return run();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortController?.abort();
      reject(new ProviderError(`provider request timed out after ${timeoutMs}ms`, { transient: true }));
    }, timeoutMs);
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function fetchWithAbort(fetchImpl: ProviderFetch, signal: AbortSignal): ProviderFetch {
  return ((input: Parameters<ProviderFetch>[0], init?: Parameters<ProviderFetch>[1]) =>
    fetchImpl(input, {
      ...init,
      signal: mergeAbortSignals(init?.signal, signal)
    })) as ProviderFetch;
}

function mergeAbortSignals(existing: AbortSignal | null | undefined, next: AbortSignal): AbortSignal {
  if (!existing) return next;
  if (existing === next) return next;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([existing, next]);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (existing.aborted || next.aborted) {
    controller.abort();
  } else {
    existing.addEventListener("abort", abort, { once: true });
    next.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && error.transient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
