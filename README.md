# Smith

Smith is a minimal terminal-first CLI coding agent. The model receives provider tools for `run`, `patch`, `sub_agent`, and `finish`. Smith executes workspace-changing tools in a PTY-backed shell, captures terminal output, appends it to the transcript, and asks the model for the next tool call until `finish` ends the run.

## Install

```sh
npm install
npm run build
npm install -g .
smith --help
```

The global install links a `smith` executable from this repo. The npm package name `smith` is already occupied on npm, so do not publish this package unless ownership or naming is resolved.

## Quick Start

Create a config:

```sh
smith config init
```

Run a task:

```sh
smith --profile default "inspect README.md and summarize this project"
```

Run interactively:

```sh
smith
```

Exit interactive mode with an empty line, `exit`, or `quit`.

## Configuration

Smith loads TOML config in this order:

1. built-in defaults
2. `~/.smith/config.toml`
3. project `.smith/config.toml`
4. CLI flags
5. API keys from environment variables named by `api_key_env`

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
stop = []
# Optional estimated pricing in USD per 1,000,000 tokens.
# input_cost_per_million_tokens = 1.25
# output_cost_per_million_tokens = 10

[profiles.default.headers]
X-Title = "Smith"

[profiles.default.body]
metadata = { app = "smith" }

[profiles.reviewer]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4-mini"
temperature = 0

[runtime]
shell = "bash"
timeout_ms = 120000
max_run_ms = 0
max_context_tokens = 128000
max_tool_output_chars = 12000
danger_review = "llm"
danger_review_profile = "reviewer"
max_turns = 20
provider_retries = 2
provider_retry_delay_ms = 250
provider_timeout_ms = 300000
sub_agent_enabled = true
sub_agent_inherit_context = true
sub_agent_max_turns = 12
read_only = false
# Optional session log directory; also settable with SMITH_LOG_DIR or --log-dir.
# log_dir = "/tmp/smith"
```

Useful flags include `--cwd`, `--quiet`, `--json`, `--profile`, `--model`, `--adapter`, `--base-url`, `--api-key-env`, `--codex-auth-path`, `--temperature`, `--max-output-tokens`, `--reasoning-effort`, `--stop`, `--input-cost-per-million-tokens`, `--output-cost-per-million-tokens`, `--max-turns`, `--max-context-tokens`, `--max-tool-output-chars`, `--danger-review`, `--read-only`, `--no-sub-agent`, `--no-sub-agent-inherit-context`, and `--log-dir`.

When a provider response includes token usage, Smith records per-turn and total usage in the run trace. If `input_cost_per_million_tokens` and/or `output_cost_per_million_tokens` are set on the active profile, traces also include estimated USD cost.

Inspect the merged config and diagnose the active profile with:

```sh
smith config show --json
smith config doctor --profile default
```

## Provider Adapters

Smith implements API wire-format adapters:

- `openai-chat`: POST `{base_url}/chat/completions`
- `openai-responses`: POST `{base_url}/responses`
- `chatgpt-codex`: POST `{base_url}/responses` using Codex ChatGPT auth from `~/.codex/auth.json`
- `gemini`: POST `{base_url}/v1beta/models/{model}:generateContent`
- `anthropic-messages`: POST `{base_url}/v1/messages`

Each adapter supports custom base URLs, custom headers, custom body extras, configurable API key environment variables, Smith tool calls, and best-effort normalized options: `temperature`, `max_output_tokens`, `reasoning_effort`, and `stop`.

For ChatGPT subscription-backed Codex usage:

```toml
[profiles.codex-chatgpt]
adapter = "chatgpt-codex"
base_url = "https://chatgpt.com/backend-api/codex"
model = "gpt-5.4-mini"
reasoning_effort = "high"
# Optional; defaults to $CODEX_HOME/auth.json or ~/.codex/auth.json.
# codex_auth_path = "/home/alice/.codex/auth.json"
```

Run `codex login` first and choose ChatGPT sign-in. Smith reuses that local Codex auth file and refreshes the OAuth token when needed.
This adapter sends a deterministic per-run prompt cache key and matching Codex session headers by default.

## Provider Tools

Smith exposes four model-visible tools:

- `run`: execute a terminal command in the current workspace.
- `patch`: apply a focused Smith patch to workspace files.
- `sub_agent`: launch an independent Smith child run for bounded repo-local work.
- `finish`: end the run with the final answer, blocker report, or user question.

Each tool call includes a required short `reason`, which Smith records in the transcript before the tool output. By default, `sub_agent` child runs inherit the parent transcript context, receive a narrowed delegated task as the final user input, and use up to `runtime.sub_agent_max_turns` turns from the parent run's budget; set `runtime.sub_agent_enabled = false` or pass `--no-sub-agent` to hide delegation for a run, and set `runtime.sub_agent_inherit_context = false` or pass `--no-sub-agent-inherit-context` to start child runs fresh. Set `runtime.sub_agent_max_turns = 0` to let children inherit the full parent budget. Sub-agent tasks can pass `read_only = true`; Smith also infers read-only mode from explicit do-not-edit wording, removes `patch`, and blocks common write commands for that child run. Smith removes the `sub_agent` tool from child runs once the maximum sub-agent depth is reached. `runtime.max_tool_output_chars` caps large terminal outputs before replaying them to the model. `runtime.max_run_ms` is an optional wall-clock budget; when set above `0`, Smith emits generic deadline reminders near the configured budget, then hides inspection and delegation tools after the budget elapses so the run can finalize. If an actual task patch is still unvalidated when that deadline elapses, or if a task patch is applied after the deadline, Smith allows one bounded `run` call for validation before hiding inspection again. `runtime.provider_timeout_ms` bounds each provider attempt and retries transient stalls according to `runtime.provider_retries`. The first `finish` ends single-shot and remote runs. A legacy `chat_out` shell helper remains available for older traces and compatibility, but the packaged prompt directs models to use `finish`.

At startup, Smith checks whether `rg` is available on PATH. If it is missing, Smith runs a short bootstrap Smith agent that may attempt a straightforward ripgrep install, with explicit instructions to stop rather than use brittle or risky installation tricks. If `rg` is still unavailable afterward, Smith appends a system-prompt environment note telling the main agent to use alternatives such as `grep` or `find`.

## Remote Mode

Remote mode is script-friendly:

```sh
smith remote --cwd ./packages/api "find why tests fail"
```

Only the first child `finish` message is printed to stdout. Status lines go to stderr unless `--quiet` is set.

Remote runs persist resumable state:

```sh
smith remote --cwd ./packages/api "inspect auth failures"
# stderr: smith remote session saved: abc123
smith remote --resume abc123 "Use the mock-token branch and continue"
```

Resume starts a fresh shell, restores the transcript context, appends the new parent answer as user input, and continues.

Remote sessions can be inspected and deleted:

```sh
smith remote list
smith remote show abc123
smith remote delete abc123
```

## smith_patch

Smith exposes a provider-level `patch` tool that runs the same terminal-native patch helper used by `smith_patch`. The shell helper remains available for compatibility:

```sh
smith_patch <<'PATCH'
*** Begin Patch
*** Update File: src/example.ts
@@
-old
+new
*** End Patch
PATCH
```

It supports focused add, update, and delete operations, rejects malformed patches, and prevents paths from escaping the working directory. Update hunks are exact, but when a hunk only misses because leading indentation differs, Smith can apply it against a single unique indentation-insensitive match and adjust the replacement indentation to the file. Ambiguous matches still fail, and the error includes visible tab/space counts plus a `cat -vet` inspection hint.

## Danger Review

Smith is powerful by design. With `danger_review = "deterministic"`, Smith locally blocks a narrow set of clearly dangerous shell inputs. With `danger_review = "llm"`, the same detector first matches commands, then asks the configured reviewer profile whether to allow or block the command. Blocked commands are not executed; the terminal transcript receives:

```text
Command too dangerous
```

The detector targets destructive root/home removals, `sudo`, downloaded scripts piped to shells, disk formatting/raw disk writes, and credential-seeking file or environment access. Set `read_only = true` or pass `--read-only` to block common filesystem write commands for inspection-only tasks. Set `danger_review = "off"` to disable the dangerous-command backstop.

## Prompts and Project Instructions

The base system prompt is packaged in `prompts/system.txt`. Smith does not inline `SMITH.md` or `SMITH.TASK.md` into the system prompt; the run transcript only reports whether local memory files exist, and the packaged prompt tells the agent to read those files explicitly when present. This keeps the provider prompt stable for caching while still allowing durable project memory and ephemeral task memory.

## Traces

Each run writes a plain text trace under:

```text
~/.smith/runs/
```

Traces include run metadata, model outputs, terminal outputs, and the final `finish` message.

Set `SMITH_LOG_DIR=/tmp/smith`, `runtime.log_dir = "/tmp/smith"`, or pass `--log-dir /tmp/smith` to write a redacted JSON session log. Benchmark logs include task id, command, stdout/stderr, trace path, sandbox path, usage, verifier result, model output, terminal output, and parsed provider event summaries.

## Benchmarks

Benchmark tasks use:

```text
Task.md
workspace/
verify.sh
```

Run one task or a directory of task folders:

```sh
smith benchmark run ./benchmarks/basic-edit
smith benchmark run ./benchmarks --profile fast
smith benchmark run ./benchmarks --agent codex --model gpt-5.4-mini --reasoning-effort high
smith benchmark run ./benchmarks --timeout-ms 120000 --image node:22-bookworm --log-dir /tmp/smith --json
smith benchmark validate ./benchmarks
```

The default local-task runner copies `workspace/` into a Docker-backed sandbox, runs Smith inside `node:22-bookworm`, then executes `verify.sh` in the sandboxed workspace. For SWE-bench Pro tasks, Smith first tries to run inside the task's own Docker image when that image can execute Smith with Node; otherwise it falls back to `node:22-bookworm`. Passing `--image` overrides the Smith editing image. With `--agent codex`, the runner executes `codex exec` on the copied workspace on the host, then runs the same verifier. Successful sandboxes are removed automatically; pass `--keep-sandbox` to preserve them for debugging.

Benchmark output includes per-task and summary token/cost data when the agent reports usage and pricing is available. Smith uses the active profile's `input_cost_per_million_tokens`, optional `cached_input_cost_per_million_tokens`, and `output_cost_per_million_tokens`; Codex includes built-in pricing for `gpt-5.4-mini`, and pricing can be overridden with `--input-cost-per-million-tokens`, `--cached-input-cost-per-million-tokens`, and `--output-cost-per-million-tokens`.

See [docs/benchmarks.md](docs/benchmarks.md) for the task taxonomy, authoring examples, maintenance workflow, and validation commands. See also [docs/architecture.md](docs/architecture.md), [docs/provider-configs.md](docs/provider-configs.md), and [docs/troubleshooting.md](docs/troubleshooting.md).

## Development

```sh
npm run build
npm test
npm run check
```

The test suite includes unit tests, fake-provider integration tests, remote resume coverage, danger-review coverage, and a Docker benchmark smoke test when Docker is available.

## Limitations

- No MCP, tools, function calling, plugin system, browser automation, editor integration, vector store, or managed workspace service.
- Remote resume restores transcript context and reconstructable state, not a live process checkpoint.
- Interactive mode runs each submitted prompt as a task; it does not yet preserve one long-lived shell across separate user prompts.
- Provider-specific advanced options are passed through with config body extras rather than modeled as first-class Smith options.
