# Smith Architecture

Smith is a terminal-first coding agent. The model receives text transcript context and returns shell input. Smith writes that input to a PTY-backed shell, captures terminal output, appends it to the transcript, and repeats until the model runs `chat_out`.

## Runtime Model

The runtime has four small responsibilities:

- Build the system prompt and transcript slice.
- Call one configured provider adapter with plain text messages.
- Execute the returned shell input in a persistent PTY.
- Record trace, usage, safety, timeout, and transcript state locally.

There are no model-visible tools, function calls, MCP servers, or JSON command schemas. `chat_out` and `smith_patch` are ordinary shell commands placed in the shell `PATH`, not provider tool calls.

## Provider Boundary

Provider adapters translate Smith's internal message shape to API wire formats:

- `openai-chat`
- `openai-responses`
- `gemini`
- `anthropic-messages`

Adapters normalize response text, token usage when available, HTTP errors, retryable failures, and optional debug request logging. Provider-specific options that Smith does not model directly belong in profile `headers` and `body` extras.

## Transcript Control

Smith keeps the packaged system prompt and recent terminal transcript. `SMITH.md` and `SMITH.TASK.md` contents are not inlined into the system prompt; the transcript reports whether local memory files exist, and the packaged prompt tells the agent to read those files explicitly when present. `runtime.max_context_chars` limits the provider context slice. By default, short and merely budget-truncated transcripts keep Smith's simple single-user-message provider shape. Once the local transcript has been compacted, Smith splits the stable initial request, memory-file presence note, optional compaction summary, and volatile recent terminal tail into separate provider user messages so stable context can remain earlier in the request shape while the tail changes. `runtime.provider_message_chain = true` or `--provider-message-chain` enables an experimental provider view where prior model commands are rendered as assistant messages and terminal outputs as user messages while the local transcript format remains unchanged. `runtime.transcript_turns`, `runtime.transcript_compaction_min_chars`, `runtime.transcript_compaction_hysteresis_turns`, and `runtime.transcript_compaction_chars` compact older terminal turns deterministically once the local transcript is large enough. The initial user request and memory-file presence note stay ahead of compaction summaries as a stable prefix. Compaction is local transcript maintenance; it is not a model tool and does not refresh the system prompt.

Profiles can set `prompt_cache_key = "auto"` or pass `--prompt-cache-key auto` to send a deterministic per-run prompt cache key where the adapter supports it. `chatgpt-codex` also sends matching Codex session headers and installation metadata when available, and preserves native Responses items between calls until local transcript compaction resets that provider-native chain. Profiles can also opt into `stateful_responses = true` or `--stateful-responses`; Smith will attempt Responses-style `previous_response_id` chaining for compatible adapters, then fall back to stateless requests if the selected backend rejects that parameter. `chatgpt-codex` does not send HTTP `previous_response_id` because that backend rejects it on the tested endpoint.

`--provider-debug` writes normal provider request/response sections to the trace and also writes an exact JSONL provider debug artifact next to the trace at `<trace>.provider-debug.jsonl`. For `chatgpt-codex`, each request record includes the exact JSON request body string sent to the provider, and each response record includes the status, raw SSE/error payload, and parsed SSE events when available. Authorization-like headers are redacted.

## Safety Boundary

Smith can run commands as the current user. Safety modes are backstops, not a sandbox:

- `danger_review = "deterministic"` blocks matched dangerous commands locally.
- `danger_review = "llm"` asks the reviewer profile after a deterministic match.
- `read_only = true` blocks common filesystem write commands.

For stronger isolation, run Smith in a container or VM controlled by the user.
