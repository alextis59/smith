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

Smith keeps the packaged system prompt and recent terminal transcript. `SMITH.md` and `SMITH.TASK.md` contents are not inlined into the system prompt; the transcript reports whether local memory files exist, and the packaged prompt tells the agent to read those files explicitly when present. `runtime.max_context_chars` limits the provider context slice. `runtime.transcript_turns`, `runtime.transcript_compaction_min_chars`, `runtime.transcript_compaction_hysteresis_turns`, and `runtime.transcript_compaction_chars` compact older terminal turns deterministically once the local transcript is large enough. The initial user request and memory-file presence note stay ahead of compaction summaries as a stable prefix. Compaction is local transcript maintenance; it is not a model tool and does not refresh the system prompt.

## Safety Boundary

Smith can run commands as the current user. Safety modes are backstops, not a sandbox:

- `danger_review = "deterministic"` blocks matched dangerous commands locally.
- `danger_review = "llm"` asks the reviewer profile after a deterministic match.
- `read_only = true` blocks common filesystem write commands.

For stronger isolation, run Smith in a container or VM controlled by the user.
