# Benchmark Suite

Smith benchmark tasks live under `benchmarks/` and each task is a self-contained coding-agent exercise. The suite is intentionally local-only: tasks must not require internet access, secrets, package installs, privileged commands, external APIs, or nondeterministic timing.

Additional named datasets live under `benchmark-datasets/`. They are launched separately from the local suite by dataset name, for example `smith benchmark run swe-bench-pro`.

## Directory Format

Each task directory must contain exactly the runner contract:

```text
Task.md
workspace/
verify.sh
```

- `Task.md` describes a realistic user request. It should explain the goal and constraints without disclosing verifier internals.
- `workspace/` contains the starting files Smith will inspect and edit inside Docker.
- `verify.sh` runs from the workspace root and must fail clearly when the final state is wrong. It should be executable, deterministic, and fast.

## Taxonomy

The 101-task suite is organized into ten groups:

| Range | Category | Focus |
| --- | --- | --- |
| 001-010 | Inspection and reporting | Read multiple files and produce concise reports |
| 011-020 | Single-file fixes | Focused JavaScript bug fixes with local tests |
| 021-030 | Multi-file changes | Entry points, helpers, exports, and CLI-like behavior |
| 031-040 | Test repair | Update stale tests or fixtures to match changed behavior |
| 041-050 | Shell scripts | Portable Bash fixes, quoting, strict mode, and file handling |
| 051-060 | Config editing | JSON, TOML, YAML, workflow, and editor config updates |
| 061-070 | Data transformation | Deterministic report generation from local data files |
| 071-080 | Edge cases | Boundary conditions in small utility functions |
| 081-090 | Documentation | Verified docs updates tied to concrete project behavior |
| 091-101 | Hard tasks | Multi-step refactors with implementation, tests, docs, and cross-file discovery |

## Running Benchmarks

Run one task:

```sh
smith benchmark run ./benchmarks/011-parse-port-default --profile fast
smith benchmark run ./benchmarks/011-parse-port-default --agent codex --model gpt-5.4-mini --reasoning-effort high
smith benchmark run ./benchmarks/001-release-note-summary --agent opencode \
  --model vibethinker-local/vibethinker-3b \
  --opencode-project /home/alextis/Work/Git/alextis59/local-opencode \
  --opencode-mode file-output \
  --timeout-ms 240000 --concurrency 1 --dry-run
```

Run a named dataset:

```sh
smith benchmark run swe-bench-pro --timeout-ms 900000
smith benchmark run swe-bench-pro/001-nodebb-nodebb-vnan --timeout-ms 900000
smith benchmark validate swe-bench-pro
```

Run every task:

```sh
smith benchmark run ./benchmarks --profile fast
```

Use runner controls:

```sh
smith benchmark run ./benchmarks --timeout-ms 120000 --image node:22-bookworm
smith benchmark run ./benchmarks --concurrency 5 --timeout-ms 120000
smith benchmark run ./benchmarks --json
smith benchmark run ./benchmarks/011-parse-port-default --keep-sandbox
smith benchmark run ./benchmarks/011-parse-port-default --log-dir /tmp/smith --json
smith benchmark run ./benchmarks/001-release-note-summary --agent opencode --opencode-mode file-output --dry-run
smith benchmark validate ./benchmarks
```

The default benchmark runner copies the task workspace into a Docker-backed sandbox, runs Smith in `node:22-bookworm`, then executes `verify.sh` in the sandboxed workspace. For Smith runs with `--timeout-ms`, the runner also supplies a generic `--max-run-ms` deadline at 75% of the task timeout and a bounded `--provider-timeout-ms` unless the caller already set them, leaving time for finalization, result capture, verifier execution, and cleanup. Smith emits deadline reminders as that budget approaches and hides inspection/delegation tools after it elapses so the run can finalize. If an actual task patch is still unvalidated when that deadline elapses, or if a task patch is applied after the deadline, Smith allows one bounded `run` call for validation before hiding inspection again. With `--agent codex`, the runner executes `codex exec` against the copied workspace on the host, then runs the same verifier. With `--agent opencode`, the runner executes `opencode run` against the copied local-task workspace on the host, stages the selected project's `opencode.json` into that sandbox while the run is active, then removes or restores that file before executing the verifier. The opencode path defaults to `vibethinker-local/vibethinker-3b`; use `--opencode-project <dir>` or `SMITH_OPENCODE_PROJECT=<dir>` to point at the project that contains the provider config, such as `/home/alextis/Work/Git/alextis59/local-opencode`. The default `--opencode-mode tools` relies on OpenCode tool calls. `--opencode-mode file-output` is a fallback for local models that produce useful text but not reliable tool calls: Smith includes a bounded small-file workspace snapshot in the prompt, asks OpenCode for strict JSON final file contents, writes those files into the sandbox, and then runs the normal verifier. The local gateway for VibeThinker file-output runs should listen on `127.0.0.1:8088` with `VIBETHINKER_FORWARD_TOOLS=false`, `VIBETHINKER_RESPONSE_FORMAT=json_object`, a conservative token cap such as `VIBETHINKER_MAX_TOKENS=512`, and OS-level CPU pinning if needed. Keep `--concurrency 1` and conservative `--timeout-ms` values for CPU-only runs. `--dry-run` validates task selection and command construction without invoking an agent or verifier. Tasks run in stable sorted order. Successful sandboxes are removed automatically; failed sandboxes are retained for inspection.

Use `--concurrency <count>` to run multiple task sandboxes at once. Result JSON and summaries preserve the stable task order, while execution is limited to the requested number of concurrent tasks.

SWE-bench Pro dataset tasks use a different task format. The runner prepares the repository workspace from the task's prebuilt Docker image, runs Smith or Codex against that copied workspace, then verifies inside the original SWE-bench Pro image using the extracted run script and parser. These tasks can be slow and image-heavy, so they should be run explicitly by dataset name rather than as part of the local `benchmarks/` suite.

Use `--log-dir /tmp/smith` or `SMITH_LOG_DIR=/tmp/smith` when iterating on failures. The runner writes one redacted JSON session log per task with the task id, command, stdout/stderr, trace path, sandbox path, usage, verifier result, model output, terminal output, and parsed provider event summaries.

Benchmark results report usage and estimated cost per task and in the summary when the selected agent exposes token counts and pricing is configured. Smith uses the active profile's input/output token prices. Codex has default `gpt-5.4-mini` prices and supports explicit overrides:

```sh
smith benchmark run ./benchmarks --agent codex --model gpt-5.4-mini --reasoning-effort high \
  --input-cost-per-million-tokens 0.75 \
  --cached-input-cost-per-million-tokens 0.075 \
  --output-cost-per-million-tokens 4.5
```

Projects can set a default benchmark profile:

```toml
[benchmark]
default_profile = "fast"
```

## Local Maintenance Checks

Regenerate the suite from the committed generator:

```sh
node scripts/generate-benchmarks.mjs
```

Validate task count, required files, executable verifiers, and solved-state verifier behavior:

```sh
node scripts/validate-benchmarks.mjs
```

Run a representative Docker-backed sample with a local fake provider after building the project:

```sh
npm run build
node scripts/run-benchmark-sample.mjs
```

Run every generated task through the same Docker-backed fake-provider path:

```sh
node scripts/run-benchmark-sample.mjs --all
```

The latest creation-time validation audit is recorded in [benchmark-validation-audit.md](benchmark-validation-audit.md).

Count task directories:

```sh
find benchmarks -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9]-*' | wc -l
```

## Adding Future Tasks

Add tasks by extending `scripts/generate-benchmarks.mjs`, regenerating the suite, and running `node scripts/validate-benchmarks.mjs`. New tasks should add meaningfully different work, not only new wording around an existing verifier pattern. Prefer local Node.js, shell, and plain text files already present in the workspace.

Good verifiers assert final behavior directly:

```sh
#!/usr/bin/env bash
set -euo pipefail
npm test
test "$(node -e 'import("./src/parse-port.js").then(m => console.log(m.parsePort("")))')" = "3000"
```

Avoid verifiers that depend on timing, network access, hidden provider state, or exact implementation text when behavior is what matters:

```sh
# Bad: nondeterministic and implementation-coupled.
sleep "$((RANDOM % 3))"
grep -q "function parsePort" src/parse-port.js
curl https://example.com/check
```

When adding or changing tasks, also run the relevant repository checks:

```sh
npm run build
npm test
npm run check
```
