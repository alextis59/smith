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
provider_retries = 2
provider_retry_delay_ms = 250
provider_debug = false
danger_review = "deterministic"
read_only = false

[benchmark]
default_profile = "local"
```

Use `smith config doctor --profile <name>` to confirm which files loaded, which profile is active, and whether the configured API key environment variable is present.
