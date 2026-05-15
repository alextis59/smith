import { describe, expect, it } from "vitest";
import type { ProfileConfig } from "../src/config.js";
import { completeWithProfile } from "../src/providers/index.js";
import {
  extractAnthropicMessagesText
} from "../src/providers/anthropic-messages.js";
import { extractGeminiText } from "../src/providers/gemini.js";
import { extractOpenAiChatText } from "../src/providers/openai-chat.js";
import { extractOpenAiResponsesText } from "../src/providers/openai-responses.js";
import type { ProviderFetch, SmithModelRequest } from "../src/providers/types.js";

describe("provider adapters", () => {
  it("maps openai-chat requests and extracts responses", async () => {
    const calls = captureFetch({
      choices: [{ message: { content: "chat_out hello" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    });

    const response = await completeWithProfile(baseRequest(), profile("openai-chat"), {
      env: { TEST_KEY: "secret" },
      fetch: calls.fetch
    });

    expect(calls.first.url).toBe("https://gateway.example/v1/chat/completions");
    expect(calls.first.headers.Authorization).toBe("Bearer secret");
    expect(calls.first.headers["X-Gateway"]).toBe("test");
    expect(calls.first.body).toMatchObject({
      model: "test-model",
      stream: false,
      max_tokens: 64,
      reasoning_effort: "low",
      stop: ["STOP"],
      gateway_extra: true
    });
    expect(response.text).toBe("chat_out hello");
    expect(response.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
  });

  it("maps openai-responses requests", async () => {
    const calls = captureFetch({ output_text: "done" });
    await completeWithProfile(baseRequest(), profile("openai-responses"), { fetch: calls.fetch });

    expect(calls.first.url).toBe("https://gateway.example/v1/responses");
    expect(calls.first.body.instructions).toBe("system");
    expect(calls.first.body.input).toContain("user: task");
    expect(calls.first.body.max_output_tokens).toBe(64);
    expect(calls.first.body.reasoning).toEqual({ effort: "low" });
  });

  it("maps anthropic messages requests", async () => {
    const calls = captureFetch({ content: [{ text: "answer" }], usage: { input_tokens: 3, output_tokens: 4 } });
    const response = await completeWithProfile(baseRequest(), profile("anthropic-messages", "https://gateway.example"), {
      env: { TEST_KEY: "secret" },
      fetch: calls.fetch
    });

    expect(calls.first.url).toBe("https://gateway.example/v1/messages");
    expect(calls.first.headers["x-api-key"]).toBe("secret");
    expect(calls.first.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls.first.body.system).toBe("system");
    expect(calls.first.body.messages).toEqual([
      { role: "user", content: "task" },
      { role: "assistant", content: "prior" }
    ]);
    expect(calls.first.body.stop_sequences).toEqual(["STOP"]);
    expect(response.text).toBe("answer");
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it("maps gemini requests", async () => {
    const calls = captureFetch({
      candidates: [{ content: { parts: [{ text: "gemini" }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }
    });
    const response = await completeWithProfile(baseRequest(), profile("gemini", "https://gateway.example"), {
      env: { TEST_KEY: "secret" },
      fetch: calls.fetch
    });

    expect(calls.first.url).toBe("https://gateway.example/v1beta/models/test-model:generateContent");
    expect(calls.first.headers["x-goog-api-key"]).toBe("secret");
    expect(calls.first.body.systemInstruction).toEqual({ parts: [{ text: "system" }] });
    expect(calls.first.body.contents).toEqual([
      { role: "user", parts: [{ text: "task" }] },
      { role: "model", parts: [{ text: "prior" }] }
    ]);
    expect(calls.first.body.generationConfig).toMatchObject({ maxOutputTokens: 64, stopSequences: ["STOP"] });
    expect(response.text).toBe("gemini");
    expect(response.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
  });

  it("extracts provider response fallback text", () => {
    expect(extractOpenAiChatText({ choices: [{ message: { content: "chat" } }] })).toBe("chat");
    expect(
      extractOpenAiResponsesText({
        output: [{ content: [{ text: "a" }, { text: "b" }] }]
      })
    ).toBe("ab");
    expect(extractAnthropicMessagesText({ content: [{ text: "a" }, { text: "b" }] })).toBe("a\nb");
    expect(extractGeminiText({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] })).toBe(
      "ab"
    );
  });
});

function baseRequest(): SmithModelRequest {
  return {
    model: "",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "task" },
      { role: "assistant", content: "prior" }
    ]
  };
}

function profile(adapter: ProfileConfig["adapter"], baseUrl = "https://gateway.example/v1"): ProfileConfig {
  return {
    adapter,
    baseUrl,
    apiKeyEnv: "TEST_KEY",
    model: "test-model",
    temperature: 0,
    maxOutputTokens: 64,
    reasoningEffort: "low",
    stop: ["STOP"],
    headers: { "X-Gateway": "test" },
    body: { gateway_extra: true },
    strictProviderOptions: false
  };
}

function captureFetch(raw: unknown): {
  fetch: ProviderFetch;
  first: { url: string; headers: Record<string, string>; body: Record<string, unknown> };
} {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl: ProviderFetch = async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({
      url: String(input),
      headers,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>
    });
    return new Response(JSON.stringify(raw), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  return {
    fetch: fetchImpl,
    get first() {
      const first = calls[0];
      if (!first) throw new Error("fetch was not called");
      return first;
    }
  };
}
