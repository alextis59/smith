# Provider Config Examples

Smith profiles describe API wire formats. The adapter name is the protocol shape; `base_url`, `model`, headers, and body extras decide the actual provider or gateway.

## OpenAI Chat

```toml
[profiles.openai]
adapter = "openai-chat"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4"
temperature = 0.2
max_output_tokens = 4096
reasoning_effort = "medium"
```

## OpenAI Responses

```toml
[profiles.responses]
adapter = "openai-responses"
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
model = "gpt-5.4"
reasoning_effort = "medium"
```

## ChatGPT Subscription via Codex Auth

Run `codex login` and choose ChatGPT sign-in first. Smith reads the same Codex auth file, uses `https://chatgpt.com/backend-api/codex/responses`, and refreshes the OAuth token when it is near expiry.
This adapter sends a deterministic per-run prompt cache key and matching Codex session headers by default.

```toml
[profiles.codex-chatgpt]
adapter = "chatgpt-codex"
base_url = "https://chatgpt.com/backend-api/codex"
model = "gpt-5.4-mini"
reasoning_effort = "high"

# Optional; defaults to $CODEX_HOME/auth.json or ~/.codex/auth.json.
# codex_auth_path = "/home/alice/.codex/auth.json"
```

## Gemini Native

```toml
[profiles.gemini]
adapter = "gemini"
base_url = "https://generativelanguage.googleapis.com"
api_key_env = "GEMINI_API_KEY"
model = "gemini-2.5-pro"
max_output_tokens = 4096
```

## Anthropic Messages

```toml
[profiles.anthropic]
adapter = "anthropic-messages"
base_url = "https://api.anthropic.com"
api_key_env = "ANTHROPIC_API_KEY"
model = "claude-sonnet-4-5"
max_output_tokens = 4096
```

## OpenRouter

```toml
[profiles.openrouter]
adapter = "openai-chat"
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"
model = "openai/gpt-5.4"

[profiles.openrouter.headers]
HTTP-Referer = "https://github.com/alextis59/smith"
X-Title = "Smith"
```

## Local Gateway

```toml
[profiles.local]
adapter = "openai-chat"
base_url = "http://127.0.0.1:8080/v1"
api_key_env = "LOCAL_LLM_API_KEY"
model = "local-model"

[profiles.local.body]
metadata = { app = "smith" }
```

## Useful Runtime Settings

```toml
[runtime]
timeout_ms = 120000
max_turns = 20
max_tool_output_chars = 12000
provider_retries = 2
provider_retry_delay_ms = 250
provider_debug = false
sub_agent_inherit_context = true
danger_review = "deterministic"
read_only = false
log_dir = "/tmp/smith"

[benchmark]
default_profile = "local"
```

Use `smith config doctor --profile <name>` to confirm which files loaded, which profile is active, and whether the configured API key environment variable is present. `max_tool_output_chars` caps oversized terminal output before Smith replays it to the model. `sub_agent_inherit_context` controls whether delegated `sub_agent` child runs inherit the parent transcript context before receiving their narrowed task. Sub-agents inherit the parent run's max-turn budget, can run in read-only mode via `read_only = true` or explicit do-not-edit task wording, and lose the `sub_agent` tool once the maximum sub-agent depth is reached. `log_dir` can also be set per run with `--log-dir` or `SMITH_LOG_DIR`.
