# Troubleshooting

## Config And Profiles

Run:

```sh
smith config doctor --profile default
smith config show --json
```

Check that the active profile exists, `base_url` is an HTTP or HTTPS URL, `model` is non-empty, and `api_key_present` is `yes` when the provider requires a key.

## Provider Failures

Smith normalizes HTTP provider errors and retries transient network failures, rate limits, and 5xx responses according to `runtime.provider_retries`. To inspect request and response metadata without API keys, enable:

```toml
[runtime]
provider_debug = true
```

Debug entries are written to the trace file under `~/.smith/runs/`.

## PTY And Timeouts

If a command hangs, Smith reports the command, elapsed time, and recent terminal output before continuing. Increase `runtime.timeout_ms` for slow local test suites. If shell startup fails, confirm the configured `runtime.shell` exists and can run interactively.

## Read-Only And Danger Review

`--read-only` blocks common write commands such as redirects, `touch`, `rm`, `mv`, `sed -i`, package installs, and `smith_patch`. It is intended for inspection tasks and can block legitimate commands that have unusual syntax.

`danger_review = "deterministic"` blocks known dangerous command patterns locally. `danger_review = "llm"` asks the reviewer profile only after a local pattern matches.

## Remote Sessions

Use:

```sh
smith remote list
smith remote show <id>
smith remote delete <id>
```

Resume errors mention whether a session is missing or corrupt. Old sessions are cleaned up according to `runtime.remote_session_ttl_days`.

## Docker Benchmarks

Confirm Docker is available:

```sh
docker info
```

Validate task structure before running:

```sh
smith benchmark validate ./benchmarks
```

Use `--keep-sandbox` to inspect a failed task sandbox. Successful sandboxes are cleaned automatically. The runner executes containers with the host UID/GID to avoid root-owned files in `.smith-bench`.
