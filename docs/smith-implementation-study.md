# Smith Implementation Study

Date: 2026-05-15

Smith is a CLI coding agent with a deliberately small surface area: one model, one terminal, one transcript. It should avoid provider lock-in, tool schemas, MCP servers, function calls, and framework-heavy orchestration. The model should operate by writing terminal input. The runtime should execute that input, append the resulting terminal output to the transcript, and ask the model for the next input.

This document studies how to implement Smith as a globally installable npm package while keeping the design simple enough to reason about and flexible enough to support OpenAI, Google Gemini, Anthropic, OpenRouter, and xAI/Grok-style APIs.

## Goals

- Keep the agent loop small: model response -> terminal input -> terminal output -> model response.
- Use plain HTTP calls to model APIs. No WebSocket dependency.
- Do not expose structured tool calls to the model.
- Let users override provider details from `~/.smith/`.
- Support local interactive mode and remote non-interactive mode.
- Make `smith` installable globally through npm.
- Keep compatibility pragmatic: provider adapters translate Smith's internal message shape into each configured API wire format.
- Let any API format point at a custom gateway, custom endpoint, and custom API key.

## Non-Goals

- No general plugin system in the first version.
- No MCP support.
- No model function calling.
- No JSON command protocol required from the model.
- No browser automation, editor integration, vector store, or managed workspace service in v1.
- No attempt to hide the fact that the terminal is powerful and dangerous. The first version should make that power explicit rather than pretending it is safe by default.

## Current Provider Surface

Smith should model provider support as API wire formats, not as hardcoded companies. A profile selects an adapter such as `openai-chat`, `gemini`, or `anthropic-messages`, then configures the base URL, model, headers, API key, and extra request fields. That makes custom gateways first-class: a Google-format gateway, Anthropic-format gateway, OpenAI-compatible gateway, or local proxy can all be configured without changing Smith code.

| API format | Adapter | Endpoint shape | Known users |
| --- | --- | --- | --- |
| OpenAI Responses | `openai-responses` | `/v1/responses` | OpenAI, xAI Responses-compatible endpoints, custom gateways |
| OpenAI Chat Completions | `openai-chat` | `/v1/chat/completions` | OpenAI, Google OpenAI compatibility, OpenRouter, xAI chat completions, custom gateways |
| Gemini native | `gemini` | `/v1beta/models/{model}:generateContent` | Google Gemini, Gemini-format custom gateways |
| Anthropic Messages | `anthropic-messages` | `/v1/messages` | Anthropic Claude, Anthropic-format custom gateways |

Smith should not depend on official SDKs. The adapters can use `fetch` from Node.js and a small amount of response parsing. Provider-specific behavior belongs in config and small adapter modules, not in the model-visible protocol.

References:

- OpenAI API reference: https://developers.openai.com/api/reference/overview
- OpenAI model endpoint support: https://developers.openai.com/api/docs/models/compare
- Google Gemini API reference: https://ai.google.dev/api
- Google Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- Anthropic Claude API overview: https://platform.claude.com/docs/en/api/overview
- OpenRouter chat completions: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- xAI chat completions: https://docs.x.ai/developers/model-capabilities/legacy/chat-completions
- npm global installs and executable links: https://docs.npmjs.com/cli/v11/configuring-npm/folders

## Core Mental Model

Smith maintains a terminal transcript. Each turn sends a compact transcript slice to the model, receives shell text, writes it to a terminal process, captures output, and repeats.

Example transcript:

```text
smith:~/project$ chat_in "Hello"
smith:~/project$ chat_out "Hello my friend"
Hello my friend
smith:~/project$ cat ./le_file.txt
welcome in the matrix
```

The model is not calling tools. It is writing terminal input. `cat`, `sed`, `rg`, `npm test`, `git diff`, and `chat_out` are all terminal commands from the model's point of view.

## Command Protocol

Smith needs one command that is not a normal user command:

```sh
chat_out "message to user"
```

Optional v1 helper commands:

```sh
smith remote "summarize test failures" --cwd . --profile fast
```

The important rule is that these helpers are shell-visible commands, not model tools.

### `chat_in`

User input should be represented in the transcript as terminal output, not executed shell input. The runtime can append:

```text
smith:~/project$ chat_in: Hello
```

or:

```text
smith:~/project$ chat_in <<'SMITH_USER'
Hello
SMITH_USER
```

The second form is safer for multiline user input and makes prompt injection easier to visually isolate. It should not be executed; it is just transcript text.

### `chat_out`

`chat_out` should be implemented by Smith itself, not by relying only on a shell alias. There are two practical options:

1. Put a real `chat_out` executable in a temporary directory prepended to `PATH`.
2. Define a shell function in the spawned shell profile.

The executable is more robust. It should print the message to the terminal transcript for readability and also emit an out-of-band sentinel to Smith's PTY reader:

```text
__SMITH_CHAT_OUT_START__
Hello
__SMITH_CHAT_OUT_END__
```

The sentinel must be hidden from the model transcript or normalized back into a simple visible `chat_out` result. In remote mode, the first `chat_out` ends the remote run and its message becomes the command's stdout.

### Should model output be raw shell?

Yes, with one constraint: Smith asks the model to output only shell input, with no Markdown fences and no narration unless it is inside `chat_out`.

This is less rigid than JSON, but still gives the runtime a simple behavior: write model output to the shell. If the model writes invalid prose, the shell will reject it, the transcript records the failure, and the model can self-correct.

As a robustness concession, if the model response starts with a `sh`, `shell`, or `bash` fenced code block, Smith should strip the wrapping fence and execute the block contents. This should be a compatibility cleanup, not the documented protocol.

## Agent Loop

The v1 loop can be this small:

1. Load config.
2. Spawn a shell in the target working directory.
3. Inject Smith helper commands into `PATH`.
4. Append system prompt and initial transcript.
5. On user input, append a `chat_in` transcript entry.
6. Call model provider over HTTP.
7. Write returned text to the shell PTY.
8. Read output until the shell prompt returns, timeout triggers, or `chat_out` appears in a mode where it should end the run.
9. Append terminal output to transcript.
10. Repeat.

The runtime should use a PTY rather than `exec` per command. A PTY preserves state across commands:

- current directory
- environment variables
- shell functions
- background jobs
- command history behavior
- REPL sessions where possible

Recommended Node dependency: `node-pty`, unless the first prototype accepts a simpler `child_process.spawn("bash")` implementation with weaker terminal fidelity.

## Prompt Design

The system prompt can be short:

```text
You are Smith, a coding agent inside a terminal.

Everything you output is sent to the terminal as shell input.
To speak to the user, run: chat_out "message"
Only use chat_out when your task is finished, when you are blocked, or when you need the user to answer a question.
In remote mode, your first chat_out ends the run and becomes stdout for the parent Smith.
Use ordinary shell commands to inspect and edit files.
Do not output Markdown fences or explanations unless they are inside chat_out.
Prefer small commands and inspect files before editing them.
If a command fails, read the terminal output and recover.
You can delegate bounded subtasks with: smith remote "task" --cwd ./path
Use remote Smith for independent inspection or implementation work when it can reduce the main task.
```

Provider adapters should pass this as the system/developer instruction where available. If a provider does not support a separate system field cleanly, Smith can prepend it to the first user message.

## Transcript and Context Management

Smith's core bet is that the model is smart enough to operate with less machinery. That does not mean unlimited transcript. The runtime needs hard context discipline.

Suggested v1 strategy:

- Keep the system prompt always.
- Keep the latest N terminal turns verbatim.
- Keep a running compact note generated by Smith itself only when transcript exceeds a threshold.
- Never summarize file contents unless the model explicitly read them or the transcript would otherwise overflow.
- Prefer shell commands that let the model re-read source of truth instead of storing huge blobs in conversation history.

Compaction can itself be terminal-native:

```sh
smith_summarize_transcript
```

But v1 can implement compaction internally because it is not a model tool; it is transcript maintenance.

## Provider Adapter Design

Use one internal request shape:

```ts
type SmithMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type SmithModelRequest = {
  messages: SmithMessage[];
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  extra?: Record<string, unknown>;
};

type SmithModelResponse = {
  text: string;
  raw: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};
```

Adapters only need:

```ts
interface ProviderAdapter {
  name: string;
  complete(request: SmithModelRequest, config: ProviderConfig): Promise<SmithModelResponse>;
}
```

### OpenAI Chat-Compatible Adapter

This adapter should cover OpenAI chat completions, Google OpenAI compatibility, OpenRouter, xAI chat completions, and custom OpenAI-compatible endpoints.

Config fields:

```toml
[profiles.default]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4"

[profiles.gemini-openai]
adapter = "openai-chat"
base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
api_key_env = "GEMINI_API_KEY"
model = "gemini-2.5-flash"

[profiles.openrouter]
adapter = "openai-chat"
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"
model = "openai/gpt-5.4"

[profiles.grok]
adapter = "openai-chat"
base_url = "https://api.x.ai/v1"
api_key_env = "XAI_API_KEY"
model = "grok-4.3"
```

Request:

```http
POST {base_url}/chat/completions
Authorization: Bearer {api_key}
Content-Type: application/json
```

Body:

```json
{
  "model": "configured-model",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": false
}
```

Response extraction:

```text
choices[0].message.content
```

### API Format Profiles

The adapter name should describe the API format, not the vendor. Any adapter can be pointed at a custom gateway:

```toml
[profiles.google-native-gateway]
adapter = "gemini"
base_url = "https://llm-gateway.example.com/google"
api_key_env = "GATEWAY_API_KEY"
model = "gemini-2.5-pro"

[profiles.anthropic-gateway]
adapter = "anthropic-messages"
base_url = "https://llm-gateway.example.com/anthropic"
api_key_env = "GATEWAY_API_KEY"
model = "claude-sonnet-4-5"

[profiles.openai-gateway]
adapter = "openai-responses"
base_url = "https://llm-gateway.example.com/openai"
api_key_env = "GATEWAY_API_KEY"
model = "gpt-5.4"
```

Profiles should also support extra headers and body fields for gateways:

```toml
[profiles.openrouter.headers]
HTTP-Referer = "https://github.com/alextis59/smith"
X-Title = "Smith"

[profiles.openrouter.body]
provider = { sort = "throughput" }
```

### OpenAI Responses Adapter

Request:

```http
POST {base_url}/responses
Authorization: Bearer {api_key}
Content-Type: application/json
```

The Responses API has a different shape and richer output structure. For Smith, keep the adapter conservative: send `instructions` plus text `input`, no tools, no structured output.

Response extraction should prefer an official text aggregate field if present, then fall back to scanning output content blocks for text.

### Anthropic Messages Adapter

Request:

```http
POST {base_url}/v1/messages
x-api-key: {api_key}
anthropic-version: 2023-06-01
Content-Type: application/json
```

Anthropic separates the system prompt from `messages`. Convert internal messages like this:

- concatenate `system` messages into `system`
- keep user and assistant messages as alternating `messages`
- if transcript construction creates adjacent same-role messages, merge them before sending

Response extraction:

```text
content[].text joined with newlines
```

### Gemini Native Adapter

Request:

```http
POST {base_url}/v1beta/models/{model}:generateContent
x-goog-api-key: {api_key}
Content-Type: application/json
```

Convert messages to Gemini `contents`:

- `user` -> `role: "user"`
- `assistant` -> `role: "model"`
- `system` -> `systemInstruction`
- content -> `parts: [{ text }]`

Response extraction:

```text
candidates[0].content.parts[].text joined
```

## Configuration

Smith should load configuration in layers:

1. built-in defaults
2. `~/.smith/config.toml`
3. project-local `.smith/config.toml`
4. CLI flags
5. environment variables for secrets

Avoid storing API keys directly unless the user explicitly chooses that. Prefer `api_key_env`.

Example:

```toml
default_profile = "default"

[profiles.default]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4"
temperature = 0.2
max_output_tokens = 4096
reasoning_effort = "medium"

[profiles.fast]
adapter = "openai-chat"
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"
model = "openai/gpt-5.4-mini"

[profiles.google-custom]
adapter = "gemini"
base_url = "https://gateway.example.com/google"
api_key_env = "GATEWAY_API_KEY"
model = "gemini-2.5-pro"

[runtime]
shell = "bash"
timeout_ms = 120000
max_context_tokens = 128000
danger_review = "llm"
danger_review_profile = "reviewer"

[profiles.reviewer]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4-mini"
temperature = 0
```

Why TOML: it is readable, supports comments, and avoids JSON's poor ergonomics for user-maintained config.

### Normalized Model Options

Smith should normalize common options as much as possible so users do not need to memorize every provider's parameter vocabulary. The config should expose a small OpenAI-inspired set, then adapters map it best-effort:

| Smith option | Values | Adapter behavior |
| --- | --- | --- |
| `temperature` | number | pass through when supported |
| `max_output_tokens` | number | map to the provider's output token field |
| `reasoning_effort` | `low`, `medium`, `high` | map to provider reasoning controls when available, otherwise omit |
| `stop` | string array | pass through or map to provider stop sequence field |

Unknown or unsupported normalized options should not fail by default. Smith should warn in trace/debug output and omit them unless `strict_provider_options = true`.

## CLI Shape

Suggested commands:

```sh
smith
smith "fix the failing tests"
smith --cwd ./repo "add a CLI flag"
smith remote "summarize this repo"
smith config path
smith config init
```

`smith` starts interactive mode if no prompt is given. If a prompt is given, it can run until the first `chat_out`, then exit.

## Remote Mode

Remote mode is how one Smith can spawn another Smith:

```sh
smith remote --cwd ./packages/api "find why tests fail"
```

Requirements:

- non-interactive
- returns only the first `chat_out` text on stdout
- logs/debug output go to stderr or a trace file
- exit code is non-zero if the child Smith fails, times out, or never calls `chat_out`
- inherits the parent profile/model by default
- accepts `--profile` to override the inherited profile
- supports recursive Smith calls
- ensures killing a parent Smith also kills all child Smith processes it owns

This lets parent Smith do:

```sh
api_report=$(smith remote --cwd ./packages/api "inspect auth tests and report likely cause")
chat_out "API report: $api_report"
```

### Remote Transcript Handling

Remote mode should not stream its full transcript to stdout, because parent Smith will treat stdout as useful data. Use:

- stdout: first `chat_out` content only
- stderr: status lines if `--quiet` is not set
- trace file: full transcript, command outputs, provider raw responses

Suggested flags:

```sh
smith remote "task" --quiet
smith remote "task" --trace /tmp/smith-child.trace
smith remote "task" --profile fast
smith remote "task" --max-turns 12
smith remote --resume sm7k2q "answer to the child's blocking question"
```

### Remote Resume

A remote child may call `chat_out` because it is blocked or needs clarification, not because it finished successfully. Smith should support resumable remote sessions identified by generated short ids.

Example interface:

```sh
smith remote --cwd ./packages/api "find why auth tests fail"
# stderr: smith remote paused: sm7k2q
smith remote --resume sm7k2q "Use the mock-token branch and continue"
```

Paused sessions should not keep a PTY process alive. When a remote Smith stops on `chat_out`, Smith should persist enough state to continue later:

- generated short id
- working directory
- profile and model config reference
- transcript and compact summary
- shell state snapshot that Smith can reasonably reconstruct, such as current directory and exported environment
- trace path

On resume, Smith starts a fresh shell, restores the reconstructable state, appends the parent answer as new `chat_in`, and continues the transcript. This is not perfect process checkpointing, but it preserves the important agent context without keeping hidden child processes alive.

## Editing Files

Smith should include one edit helper in v1:

```sh
smith_patch <<'PATCH'
*** Begin Patch
*** Update File: path/to/file
@@
-old
+new
*** End Patch
PATCH
```

`smith_patch` is still terminal-native: it is a shell command, not a model function call. It gives the model a reliable way to apply focused patches with useful diagnostics.

The model can still use ordinary terminal-native techniques when they are simpler:

- `sed`
- `perl -0pi`
- `python - <<'PY'` if available
- here-documents
- `node -e`
- package-specific formatters

This is consistent with the philosophy because the model still only sees a terminal. The runtime does not expose a structured edit tool through provider APIs.

`smith_patch` should reject malformed patches, print clear terminal output, and avoid silently creating broad unrelated edits.

## Safety Model

Smith is intentionally powerful. The honest safety model is:

- By default, Smith can run whatever the current user can run.
- Users should run it in repos they trust.
- Project maintainers should not ask random Smith instances to work on untrusted code without a sandbox.

Recommended v1 safety features:

- `danger_review = "llm"`: before clearly dangerous commands, make a separate model call that reviews the command and recent context. If it judges the command too dangerous, do not execute it and print `Command too dangerous` as terminal output for Smith to handle.
- `danger_review = "off"`: execute commands directly.
- `danger_review = "ask"`: ask the user before commands matching `rm`, `sudo`, `curl | sh`, disk formatting, credential file access, etc.
- `--deny-network`: run shell with network disabled where OS/container support exists. This can be added after the basic loop.
- `--container`: execute inside a disposable container. This can share infrastructure with the benchmark runner.
- `--readonly`: allow inspection but block writes. This can be added after the basic loop.

These should be runtime flags, not model-visible tools.

The LLM danger reviewer should use a separate configured reviewer profile, not the active Smith profile. It should be deliberately narrow: a backstop for destructive or credential-seeking commands, not a general policy engine. It should receive the command, working directory, recent transcript, and a small set of hard rules. It should return allow/block internally; Smith only shows the terminal result.

## Logging and Debugging

Smith should write a plain text trace:

```text
~/.smith/runs/2026-05-15T12-30-00Z.trace
```

Trace contents:

- profile and adapter name
- working directory
- system prompt version
- model request metadata without API key
- model output
- terminal output
- first `chat_out` that ended the run, if any

Keep raw provider JSON optional behind `--trace-raw`, because it may contain user code and secrets.

## npm Package Structure

Recommended first structure:

```text
smith/
  package.json
  README.md
  LICENSE
  docs/
    smith-implementation-study.md
  src/
    cli.ts
    config.ts
    loop.ts
    pty.ts
    danger-review.ts
    patch.ts
    transcript.ts
    remote-sessions.ts
    providers/
      index.ts
      openai-chat.ts
      openai-responses.ts
      anthropic-messages.ts
      gemini.ts
    benchmark/
      runner.ts
      sandbox.ts
  bin/
    smith.js
```

`package.json`:

```json
{
  "name": "smith",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "smith": "./bin/smith.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Node 20 is a practical floor because it includes stable enough built-in `fetch` and modern ESM behavior.

## Minimal v1 Implementation Plan

1. Create npm/TypeScript skeleton.
2. Implement config loading from `~/.smith/config.toml`, `.smith/config.toml`, and flags.
3. Implement provider adapter plumbing as API wire formats, starting with `openai-chat`, `gemini`, and `anthropic-messages`.
4. Implement normalized model options and best-effort adapter mapping.
5. Implement PTY shell runner.
6. Implement transcript loop.
7. Implement `chat_out` helper command and sentinel extraction.
8. Implement interactive `smith` mode.
9. Implement `smith remote` mode with stdout-only first `chat_out` output.
10. Add recursive process tracking so killing a parent Smith kills child Smith processes.
11. Add short-id remote resume with persisted session state.
12. Add `smith_patch` helper command.
13. Add LLM danger review through a separate reviewer profile.
14. Add traces and max-turn/time limits.
15. Add Docker-backed benchmark runner.
16. Publish package with `bin.smith`.

The first useful milestone can be much smaller:

```sh
smith --profile openrouter "inspect README and say what this project is"
```

It should launch, run `cat README.md`, call `chat_out`, and exit.

## Project Instructions

The base system prompt should stay versioned inside the package. Users should not need to replace it to add project context.

Smith should additionally load project instructions from `SMITH.md` when present. A simple lookup rule:

1. Start from the working directory.
2. Walk upward until the filesystem root or git root.
3. Load the closest `SMITH.md`.
4. Append it after the packaged prompt as project-specific guidance.

`SMITH.md` should be additive. It can describe repo conventions, test commands, style preferences, and project-specific constraints. It should not replace Smith's terminal protocol.

## Benchmark Tool

Smith should include a benchmark runner for repeatable agent tasks:

```sh
smith benchmark run ./benchmarks/basic-edit
smith benchmark run ./benchmarks --profile fast
```

A benchmark task directory can contain:

```text
Task.md
workspace/
verify.sh
```

Execution model:

1. Copy `workspace/` into a Docker-backed sandbox.
2. Run Smith in that sandbox with `Task.md` as the user task.
3. Stop on first `chat_out`, timeout, or max turns.
4. Run `verify.sh` inside the sandbox.
5. Report pass/fail, duration, turns, token usage, and trace path.

Docker should be the first benchmark backend. Other backends can come later, but the initial benchmark design should assume Docker is available so tasks are repeatable and isolated from the host.

## Testing Strategy

Unit tests:

- config merge precedence
- adapter request construction
- adapter response extraction
- transcript truncation
- `chat_out` sentinel parsing
- `smith_patch` parsing and failure diagnostics

Integration tests:

- fake provider HTTP server returns shell commands
- Smith executes commands in a temp repo
- remote mode returns only first `chat_out`
- timeouts kill hanging shell commands
- stderr/stdout separation in remote mode
- parent process termination kills child Smith processes
- remote resume restores persisted transcript by short id
- danger review blocks obviously destructive commands
- benchmark runner copies a task workspace, runs Smith, and executes verifier

Manual provider tests:

- OpenAI-compatible endpoint
- Google OpenAI compatibility endpoint
- Anthropic Messages
- Gemini native
- OpenRouter
- xAI

Provider tests should be opt-in and require environment variables.

## Key Risks

### Model outputs prose instead of commands

This is expected occasionally. Let the shell error be visible in the transcript. The model can recover. The prompt should stay blunt that all output is shell input.

### Shell quoting breaks `chat_out`

Use a real command that accepts stdin:

```sh
chat_out <<'SMITH'
multiline answer
SMITH
```

The prompt should teach both quoted single-line and heredoc multiline forms.

### Provider message formats diverge

Keep adapters small and user-overridable. Every API-format adapter should allow custom base URLs, arbitrary headers, and body extras from config.

### Context grows too fast

Make transcript limits visible and deterministic. Add trace files so users can inspect what was dropped.

### Remote child Smith pollutes parent stdout

Remote mode must reserve stdout for the first `chat_out` content only. Everything else goes to stderr or trace.

### Long-running commands block the loop

Use PTY inactivity timeout and total command timeout. The timeout output becomes transcript data so the model can decide what to do next.

## Resolved Decisions

1. Model responses are raw shell input. If a response starts with a shell fenced block, Smith strips the fence as a compatibility cleanup.
2. `chat_out` prints visibly to the terminal transcript.
3. Remote mode returns the first `chat_out` on stdout. No `chat_out --final` is needed for v1.
4. `chat_out` should be reserved for finished, blocked, or question states. This belongs in the packaged system prompt.
5. Remote Smith inherits the parent profile/model by default, with `--profile` available as an override.
6. Recursive Smith is allowed. Parent termination must terminate owned child Smith processes.
7. Config should use TOML.
8. The base system prompt stays versioned in the package. Project-specific additions come from `SMITH.md`.
9. Provider options should be normalized as much as possible, using a small OpenAI-inspired vocabulary.
10. The intended npm package name is `smith`.
11. Provider support should be based on API wire-format adapters, so Google-format custom gateways and other custom endpoints are first-class.
12. Smith should include an LLM danger review path instead of relying only on user approvals.
13. Smith should plan for a benchmark runner with task folders, sandboxed execution, and verifier scripts.
14. Remote resume should use generated short ids.
15. Paused remote sessions should not remain live; Smith should persist enough state to resume later in a fresh shell.
16. The LLM danger reviewer should use a separate configured reviewer profile.
17. The benchmark runner should use Docker as its first sandbox backend.
18. `smith_patch` should be included in v1 as a terminal-native patch helper.

## Recommendation

Build the first prototype around API-format provider adapters, a PTY-backed shell, visible `chat_out`, and `smith remote`. `openai-chat`, `gemini`, and `anthropic-messages` should be early adapters because the config model must prove that custom gateways are first-class, not an afterthought.

The important design line is not "no abstractions." It is "no model-visible orchestration abstractions." Internally, Smith still needs clean provider adapters, config loading, transcript management, and process control. Externally, the model gets a terminal.
