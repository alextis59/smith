# Smith Architecture

Smith is a terminal-first coding agent. The model receives transcript context plus provider tools, calls `run` to execute terminal commands in a persistent PTY, and calls `finish` to end the run. Smith captures terminal output, appends it to the transcript, and repeats until `finish` is called.

## Runtime Model

The runtime has four small responsibilities:

- Build the system prompt and transcript slice.
- Call one configured provider adapter with structured messages and Smith tool definitions.
- Execute `run` tool calls in a persistent PTY, and launch bounded child Smith runs for `sub_agent` tool calls.
- Record trace, usage, safety, timeout, and transcript state locally.

The model-visible tools are `run`, `patch`, `sub_agent`, and `finish`, and provider adapters request tool use instead of plain text where the API supports it. Each tool call requires a short `reason`; Smith records that reason in the transcript before the tool result. `patch` runs the same parser and diagnostics as the terminal-native `smith_patch` helper. By default, `sub_agent` child runs inherit the parent transcript, append a narrowed delegated task as the final user input, and use up to `runtime.sub_agent_max_turns` turns from the parent run's budget, so the child sees the same working context without seeing the parent function call. Set `runtime.sub_agent_max_turns = 0` to let child runs inherit the full parent budget. Sub-agent tasks can run read-only; Smith also infers that mode from explicit do-not-edit wording, removes `patch`, and blocks common write commands. Set `runtime.sub_agent_inherit_context = false` or pass `--no-sub-agent-inherit-context` to start child runs with only the delegated task. Smith removes the `sub_agent` tool from child runs once the maximum sub-agent depth is reached. `runtime.max_tool_output_chars` caps large terminal and sub-agent outputs before they are appended to the transcript and sent back to the provider. `runtime.provider_timeout_ms` bounds each provider attempt so stalled model calls fail transiently and can be retried. `smith_patch` remains an ordinary shell command placed in the PTY `PATH` for compatibility. A legacy `chat_out` helper still exists in the shell for compatibility, but the packaged prompt tells models to use `finish`.

## Benchmark Containers

Local benchmark tasks run Smith in `node:22-bookworm` against a copied workspace, then run the task verifier after Smith exits. SWE-bench Pro tasks copy `/app` from the task image into a sandboxed workspace. For Smith runs, the runner probes the task image and uses it for the editing loop when it can execute `node /smith/bin/smith.js --version`; this gives Smith access to project toolchains that are already present in the task image. If the task image cannot run Smith, the runner falls back to `node:22-bookworm`. The SWE-bench Pro verifier still runs after `finish` in the original task image.

## Provider Boundary

Provider adapters translate Smith's internal message shape to API wire formats:

- `openai-chat`
- `openai-responses`
- `gemini`
- `anthropic-messages`

Adapters normalize response text, tool calls, token usage when available, HTTP errors, retryable failures, and optional debug request logging. Provider-specific options that Smith does not model directly belong in profile `headers` and `body` extras.

## Transcript Control

Smith keeps the packaged system prompt and terminal transcript. `SMITH.md` and `SMITH.TASK.md` contents are not inlined into the system prompt; the transcript reports whether local memory files exist, and the packaged prompt tells the agent to read those files explicitly when present. `runtime.max_context_tokens` is the single compaction threshold. When the estimated provider context reaches that threshold, Smith compacts the local transcript by replacing tool action parameters and outputs with compact action notes that keep only the action name and reason. User inputs are preserved. If the compacted context is still above the threshold, Smith removes the oldest compacted action notes until the context is near half the token budget or no removable action notes remain. A stable context-compacted notice remains in the chain after compaction. Compaction is local transcript maintenance; it is not a model tool and does not refresh the system prompt.

Profiles can set `prompt_cache_key = "auto"` or pass `--prompt-cache-key auto` to send a deterministic per-run prompt cache key where the adapter supports it. `chatgpt-codex` uses this auto cache identity by default, also sends matching Codex session headers and installation metadata when available, and preserves native Responses tool calls and tool outputs between calls until local transcript compaction resets that provider-native chain. Encrypted reasoning items remain available in provider debug logs but are not replayed as future input. Profiles can also opt into `stateful_responses = true` or `--stateful-responses`; Smith will attempt Responses-style `previous_response_id` chaining for compatible adapters, then fall back to stateless requests if the selected backend rejects that parameter. `chatgpt-codex` does not send HTTP `previous_response_id` because that backend rejects it on the tested endpoint.

`--provider-debug` writes provider request/response sections to the trace and also writes an exact JSONL provider debug artifact next to the trace at `<trace>.provider-debug.jsonl`. ChatGPT Codex SSE response traces omit streaming `.delta` event blocks to keep traces readable; the JSONL artifact still retains the raw SSE payload. For `chatgpt-codex`, each request record includes the exact JSON request body string sent to the provider, and each response record includes the status, raw SSE/error payload, and parsed SSE events when available. Authorization-like headers are redacted.

## Safety Boundary

Smith can run commands as the current user. Safety modes are backstops, not a sandbox:

- `danger_review = "deterministic"` blocks matched dangerous commands locally.
- `danger_review = "llm"` asks the reviewer profile after a deterministic match.
- `read_only = true` blocks common filesystem write commands.

For stronger isolation, run Smith in a container or VM controlled by the user.
