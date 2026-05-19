import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileConfig } from "../src/config.js";
import { completeWithProfile, ProviderError } from "../src/providers/index.js";
import { parseResponsesSse } from "../src/providers/chatgpt-codex.js";
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
    expect(calls.first.body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "task" }] },
      { role: "assistant", content: [{ type: "output_text", text: "prior" }] }
    ]);
    expect(calls.first.body.max_output_tokens).toBe(64);
    expect(calls.first.body.reasoning).toEqual({ effort: "low" });
  });

  it("maps openai-responses stateful requests", async () => {
    const calls = captureFetch({ id: "resp_2", output_text: "done" });
    const response = await completeWithProfile(
      {
        ...baseRequest(),
        providerState: {
          statefulResponses: true,
          previousResponseId: "resp_1",
          promptCacheKey: "smith-test",
          promptCacheRetention: "24h"
        }
      },
      profile("openai-responses"),
      { fetch: calls.fetch }
    );

    expect(calls.first.body).toMatchObject({
      store: true,
      previous_response_id: "resp_1",
      prompt_cache_key: "smith-test",
      prompt_cache_retention: "24h"
    });
    expect(response.providerState?.previousResponseId).toBe("resp_2");
  });

  it("maps chatgpt-codex requests using Codex auth storage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smith-codex-auth-"));
    const authPath = join(dir, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          refresh_token: "refresh-token",
          account_id: "account-id"
        },
        last_refresh: new Date().toISOString()
      }),
      "utf8"
    );
    const calls = captureFetch(
        [
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"done"}',
          'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":5,"input_tokens_details":{"cached_tokens":3},"output_tokens":6,"output_tokens_details":{"reasoning_tokens":4},"total_tokens":11}}}'
        ].join("\n\n"),
        "text/event-stream"
    );
    const chatgptProfile = { ...profile("chatgpt-codex", "https://chatgpt.example/backend-api/codex"), codexAuthPath: authPath };

    const response = await completeWithProfile(baseRequest(), chatgptProfile, { fetch: calls.fetch });

    expect(calls.first.url).toBe("https://chatgpt.example/backend-api/codex/responses");
    expect(calls.first.headers.Authorization).toMatch(/^Bearer /);
    expect(calls.first.headers["ChatGPT-Account-ID"]).toBe("account-id");
    expect(calls.first.body).toMatchObject({
      model: "test-model",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      gateway_extra: true
    });
    expect(calls.first.body.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "shell_command"
      })
    ]);
    expect(calls.first.body).not.toHaveProperty("max_output_tokens");
    expect(response.text).toBe("done");
    expect(response.usage).toEqual({
      inputTokens: 5,
      cachedInputTokens: 3,
      outputTokens: 6,
      reasoningOutputTokens: 4,
      totalTokens: 11
    });
  });

  it("maps chatgpt-codex stateful tool output requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smith-codex-auth-"));
    const authPath = join(dir, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          refresh_token: "refresh-token"
        }
      }),
      "utf8"
    );
    const calls = captureFetch(
      [
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"id":"fc_2","call_id":"call_2","type":"function_call","name":"shell_command","arguments":"{\\"command\\":\\"pwd\\"}"}}',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_2","usage":{"input_tokens":5}}}'
      ].join("\n\n"),
      "text/event-stream"
    );
    const chatgptProfile = { ...profile("chatgpt-codex", "https://chatgpt.example/backend-api/codex"), codexAuthPath: authPath };

    const response = await completeWithProfile(
      {
        ...baseRequest(),
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "terminal output" }
        ],
        providerState: {
          statefulResponses: true,
          previousResponseId: "resp_1",
          previousToolCallId: "call_1",
          toolOutput: "terminal output",
          promptCacheKey: "smith-test"
        }
      },
      chatgptProfile,
      { fetch: calls.fetch }
    );

    expect(calls.first.body).toMatchObject({
      store: false,
      previous_response_id: "resp_1",
      prompt_cache_key: "smith-test",
      input: [{ type: "function_call_output", call_id: "call_1", output: "terminal output" }]
    });
    expect(response.text).toBe("pwd");
    expect(response.providerState?.previousResponseId).toBe("resp_2");
    expect(response.providerState?.previousToolCallId).toBe("call_2");
  });

  it("retries chatgpt-codex response stream failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smith-codex-auth-"));
    const authPath = join(dir, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          refresh_token: "refresh-token"
        },
        last_refresh: new Date().toISOString()
      }),
      "utf8"
    );
    let count = 0;
    const fetchImpl: ProviderFetch = async () => {
      count += 1;
      if (count === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => {
            throw new Error("terminated");
          }
        } as Response;
      }
      return new Response(
        [
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"done"}',
          'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":5,"input_tokens_details":{"cached_tokens":3},"output_tokens":6,"output_tokens_details":{"reasoning_tokens":4},"total_tokens":11}}}'
        ].join("\n\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    };
    const chatgptProfile = { ...profile("chatgpt-codex", "https://chatgpt.example/backend-api/codex"), codexAuthPath: authPath };

    const response = await completeWithProfile(baseRequest(), chatgptProfile, {
      fetch: fetchImpl,
      retries: 1,
      retryDelayMs: 1
    });

    expect(response.text).toBe("done");
    expect(count).toBe(2);
    expect(response.usage).toEqual({
      inputTokens: 5,
      cachedInputTokens: 3,
      outputTokens: 6,
      reasoningOutputTokens: 4,
      totalTokens: 11
    });
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
    expect(parseResponsesSse('event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"codex"}')).toMatchObject({
      text: "codex"
    });
    expect(
      parseResponsesSse(
        [
          'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":""}',
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"pwd"}',
          'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"pwd"}',
          'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":""}'
        ].join("\n\n")
      )
    ).toMatchObject({ text: "pwd" });
    expect(
      parseResponsesSse(
        [
          'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","name":"shell_command","arguments":""}}',
          'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"command\\":\\"npm"}',
          'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":" test\\"}"}',
          'event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\\"command\\":\\"npm test\\"}"}'
        ].join("\n\n")
      )
    ).toMatchObject({ text: "npm test", toolCallId: "fc_1" });
  });

  it("normalizes malformed provider responses", async () => {
    const calls = captureFetch({ choices: [] });
    await expect(completeWithProfile(baseRequest(), profile("openai-chat"), { fetch: calls.fetch })).rejects.toThrow(
      "openai-chat response did not contain assistant text"
    );
  });

  it("retries transient provider errors and logs debug requests", async () => {
    const debug: string[] = [];
    let count = 0;
    const fetchImpl: ProviderFetch = async () => {
      count += 1;
      if (count === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const response = await completeWithProfile(baseRequest(), profile("openai-chat"), {
      env: { TEST_KEY: "secret" },
      fetch: fetchImpl,
      retries: 1,
      retryDelayMs: 1,
      debugLog: (_section, content) => debug.push(content)
    });

    expect(response.text).toBe("ok");
    expect(count).toBe(2);
    expect(debug.join("\n")).toContain("[redacted]");
  });

  it("marks normalized 5xx provider errors as transient", async () => {
    const fetchImpl: ProviderFetch = async () =>
      new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });

    await expect(completeWithProfile(baseRequest(), profile("openai-chat"), { fetch: fetchImpl })).rejects.toMatchObject({
      name: "ProviderError",
      transient: true
    } satisfies Partial<ProviderError>);
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
    statefulResponses: false,
    temperature: 0,
    maxOutputTokens: 64,
    reasoningEffort: "low",
    stop: ["STOP"],
    headers: { "X-Gateway": "test" },
    body: { gateway_extra: true },
    strictProviderOptions: false
  };
}

function captureFetch(raw: unknown, contentType = "application/json"): {
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
    return new Response(contentType === "application/json" ? JSON.stringify(raw) : String(raw), {
      status: 200,
      headers: { "Content-Type": contentType }
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

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
