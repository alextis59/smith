# Smith

Smith is a minimal terminal-first CLI coding agent. The model does not receive tools, function calls, MCP servers, skills, or JSON command schemas. It outputs shell input; Smith writes that input to a PTY-backed shell, captures terminal output, appends it to the transcript, and asks the model for the next shell input.

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
transcript_turns = 20
max_context_chars = 120000
danger_review = "llm"
danger_review_profile = "reviewer"
```

Useful flags include `--cwd`, `--profile`, `--model`, `--adapter`, `--base-url`, `--api-key-env`, `--temperature`, `--max-output-tokens`, `--reasoning-effort`, `--stop`, and `--danger-review`.

## Provider Adapters

Smith implements API wire-format adapters:

- `openai-chat`: POST `{base_url}/chat/completions`
- `openai-responses`: POST `{base_url}/responses`
- `gemini`: POST `{base_url}/v1beta/models/{model}:generateContent`
- `anthropic-messages`: POST `{base_url}/v1/messages`

Each adapter supports custom base URLs, custom headers, custom body extras, configurable API key environment variables, and best-effort normalized options: `temperature`, `max_output_tokens`, `reasoning_effort`, and `stop`.

## chat_out

To speak to the user, the model runs:

```sh
chat_out "message"
```

For multiline output:

```sh
chat_out <<'SMITH'
message
SMITH
```

The first `chat_out` ends single-shot and remote runs. Smith keeps `chat_out` visible in the terminal transcript while hiding its internal sentinel markers.

## Remote Mode

Remote mode is script-friendly:

```sh
smith remote --cwd ./packages/api "find why tests fail"
```

Only the first child `chat_out` text is printed to stdout. Status lines go to stderr unless `--quiet` is set.

Remote runs persist resumable state:

```sh
smith remote --cwd ./packages/api "inspect auth failures"
# stderr: smith remote session saved: abc123
smith remote --resume abc123 "Use the mock-token branch and continue"
```

Resume starts a fresh shell, restores the transcript context, appends the new parent answer as `chat_in`, and continues.

## smith_patch

Smith installs a terminal-native patch helper into the agent shell:

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

It supports focused add, update, and delete operations, rejects malformed patches, and prevents paths from escaping the working directory.

## Danger Review

Smith is powerful by design. With `danger_review = "llm"`, Smith detects a narrow set of clearly dangerous shell inputs, then asks the configured reviewer profile whether to allow or block the command. Blocked commands are not executed; the terminal transcript receives:

```text
Command too dangerous
```

The detector targets destructive root/home removals, `sudo`, downloaded scripts piped to shells, disk formatting/raw disk writes, and credential-seeking file or environment access. Set `danger_review = "off"` to disable this backstop.

## Prompts and Project Instructions

The base system prompt is packaged in `prompts/system.txt`. Smith also searches upward from the working directory for the closest `SMITH.md` and appends it as additive project instructions.

## Traces

Each run writes a plain text trace under:

```text
~/.smith/runs/
```

Traces include run metadata, model outputs, terminal outputs, and the final `chat_out`.

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
```

The runner copies `workspace/` into a Docker-backed sandbox, runs Smith inside `node:22-bookworm`, then executes `verify.sh` in the sandboxed workspace.

See [docs/benchmarks.md](docs/benchmarks.md) for the task taxonomy, maintenance workflow, and validation commands.

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
