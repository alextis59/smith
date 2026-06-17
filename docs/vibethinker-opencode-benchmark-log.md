# VibeThinker OpenCode Benchmark Log

Purpose: track conservative experiments for running Smith benchmark tasks through OpenCode with the local `vibethinker-local/vibethinker-3b` model from `/home/alextis/Work/Git/alextis59/local-opencode`.

Safety defaults:

- Gateway: `http://127.0.0.1:8088/v1`
- Agent: `opencode`
- Model: `vibethinker-local/vibethinker-3b`
- Concurrency: `1`
- SWE-bench Pro tasks: not used
- First pass: dry-run/smoke validation before real task execution
- Gateway token caps: keep `VIBETHINKER_DEFAULT_MAX_TOKENS` and `VIBETHINKER_MAX_TOKENS` conservative for CPU-only runs

## 2026-06-16

### Repository and Gateway Inspection

- Task: none; environment inspection only.
- Command:

```sh
git status --short --branch
curl -fsS http://127.0.0.1:8088/healthz
curl -fsS http://127.0.0.1:8088/v1/models | python3 -m json.tool
ps -o pid,ppid,pcpu,pmem,rss,etime,cmd -p 32041
```

- Result: Smith worktree started clean on `auto-research`; local-opencode worktree started clean on `main`.
- Gateway: already running as `python3 scripts/serve_gateway.py`, healthy on `127.0.0.1:8088`.
- Model endpoint: returned `vibethinker-3b`.
- Process observation: gateway process RSS was about 48 MB before a successful generation request loaded the model.
- Decision: do not start another gateway or any parallel inference process.

### OpenCode Config Resolution Probe

- Task: none; CLI behavior probe only.
- Command:

```sh
timeout 90s opencode run \
  --model vibethinker-local/vibethinker-3b \
  --format json \
  --dir /tmp/opencode-config-probe \
  --title smith-config-probe \
  'Reply with exactly OK.'
```

- Runtime: about 2 seconds.
- Result: failed before inference with `ProviderModelNotFoundError`.
- Observation: when `--dir` points at the benchmark workspace, OpenCode resolves project config from that directory, so it does not see `/home/alextis/Work/Git/alextis59/local-opencode/opencode.json`.
- Decision: the benchmark runner should stage the selected project's `opencode.json` into the temporary benchmark workspace for the opencode run, then remove or restore it before verification.

### Benchmark Tool Implementation

- Task: code/documentation change.
- Command:

```sh
npm run build
```

- Result: passed after adding the opencode runner path and dry-run option.
- Implemented settings:
  - `--agent opencode`
  - default model `vibethinker-local/vibethinker-3b`
  - `--opencode-project <dir>` and `SMITH_OPENCODE_PROJECT`
  - `--dry-run`
  - sandboxed OpenCode state via `HOME` and XDG variables under the benchmark sandbox
  - local-task-only opencode support; SWE-bench Pro is intentionally rejected
- Next decision: run unit tests, then dry-run the easiest local task before any real bounded benchmark attempt.

### Unit and Dry-Run Validation

- Task: `benchmarks/001-release-note-summary` (`Difficulty: easy`).
- Commands:

```sh
npx vitest run tests/benchmark.test.ts tests/cli.test.ts
node bin/smith.js benchmark run ./benchmarks/001-release-note-summary \
  --agent opencode \
  --model vibethinker-local/vibethinker-3b \
  --opencode-project /home/alextis/Work/Git/alextis59/local-opencode \
  --timeout-ms 120000 \
  --concurrency 1 \
  --dry-run \
  --log-dir /tmp/smith-vibethinker \
  --json
```

- Result: tests passed (`27 passed`); dry-run passed.
- Dry-run log: `/tmp/smith-vibethinker/2026-06-16T20-15-25-668Z-opencode-001-release-note-summary.json`.
- Validated command shape:

```sh
opencode run --pure --format json \
  --model vibethinker-local/vibethinker-3b \
  --dir <sandbox-workspace> \
  --title smith-benchmark-workspace \
  --no-replay \
  --dangerously-skip-permissions \
  <benchmark prompt>
```

- Observation: dry-run did not invoke the model or verifier, and sandbox cleanup completed.
- Decision: proceed to one real easy task with the same single-task, 120s timeout settings.

### Easy Task Real Run

- Task: `benchmarks/001-release-note-summary` (`Difficulty: easy`).
- Command:

```sh
node bin/smith.js benchmark run ./benchmarks/001-release-note-summary \
  --agent opencode \
  --model vibethinker-local/vibethinker-3b \
  --opencode-project /home/alextis/Work/Git/alextis59/local-opencode \
  --timeout-ms 120000 \
  --concurrency 1 \
  --log-dir /tmp/smith-vibethinker \
  --json
```

- Runtime: `49378ms`.
- Result: failed verifier; log `/tmp/smith-vibethinker/2026-06-16T20-16-33-086Z-opencode-001-release-note-summary.json`.
- Verifier: `bash <sandbox>/task/verify.sh`, exit `1`.
- Observed model behavior: OpenCode reached the local gateway and emitted JSON events, but the model produced truncated reasoning text with finish reason `length` and did not write `summary.md`.
- Workspace observation: retained sandbox contains only the original `README.md` and source notes; no `summary.md` was created. The staged `opencode.json` was removed before verification as intended.
- Gateway/process observation: one gateway process remained; no `opencode run` process remained. Gateway RSS after model load was about `3705536 KiB`; available system memory was about `9.7 GiB` before the run.
- Stability: no crash, no parallel inference, no runaway process.
- Decision: do not progress to harder tasks because the easy task is not stable. Recommended next settings for a future single-run experiment are to restart the gateway with `VIBETHINKER_FORWARD_TOOLS=true`, raise `VIBETHINKER_MAX_TOKENS` conservatively to `128` or `256`, keep `VIBETHINKER_N_CTX=8192`, set a bounded thread count such as `VIBETHINKER_N_THREADS=4`, and keep benchmark `--concurrency 1`.

### Final Verification

- Commands:

```sh
npm run check
curl -fsS http://127.0.0.1:8088/healthz
pgrep -af 'opencode run|serve_gateway|local_opencode_gateway|llama|uvicorn'
```

- Result: `npm run check` passed (`212 passed` across `13` test files).
- Gateway health: still returns `{"ok":true,"model":"vibethinker-3b",...}`.
- Process state: one intended gateway process remains on `127.0.0.1:8088`; no `opencode run` benchmark process remains.

### Continued Tool-Calling Experiments

- Reason for continuing: the first integration run proved invocation, but did not produce useful benchmark results.
- Gateway setting tried:

```sh
taskset -c 0,1 env \
  OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 NUMEXPR_NUM_THREADS=2 \
  VIBETHINKER_FORWARD_TOOLS=true \
  VIBETHINKER_FORWARD_TOOL_NAMES=write,edit,bash \
  VIBETHINKER_DEFAULT_MAX_TOKENS=256 \
  VIBETHINKER_MAX_TOKENS=256 \
  VIBETHINKER_N_THREADS=2 \
  VIBETHINKER_N_CTX=8192 \
  VIBETHINKER_LOG_COMPLETIONS=true \
  python3 scripts/serve_gateway.py
```

- Direct probe: asked OpenCode to create `ok.txt`; timed out at `90s`, no file created.
- Easy benchmark after replacing Smith-specific prompt text with OpenCode-native tool guidance:

```sh
node bin/smith.js benchmark run ./benchmarks/001-release-note-summary \
  --agent opencode \
  --model vibethinker-local/vibethinker-3b \
  --opencode-project /home/alextis/Work/Git/alextis59/local-opencode \
  --timeout-ms 180000 \
  --concurrency 1 \
  --log-dir /tmp/smith-vibethinker \
  --json
```

- Result: failed by timeout at `180142ms`; log `/tmp/smith-vibethinker/2026-06-16T21-34-35-780Z-opencode-001-release-note-summary.json`.
- Observation: the gateway forwarded only `bash`, `edit`, and `write`; the process stayed pinned to two CPUs, but the model still emitted reasoning only and no tool calls.
- Decision: tool-calling mode is not satisfying for this local CPU setup.

### File-Output Mode Implementation

- Added Smith `--opencode-mode file-output`.
- Added local gateway `VIBETHINKER_RESPONSE_FORMAT=json_object`.
- File-output mode behavior:
  - Smith supplies a bounded snapshot of small workspace files.
  - OpenCode returns strict JSON: `{ "files": { "relative/path": "complete content" } }`.
  - Smith writes those files into the sandbox after removing the staged `opencode.json`.
  - Smith runs the normal verifier.
- Tests:

```sh
npm run build
npx vitest run tests/benchmark.test.ts tests/cli.test.ts
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest
```

- Result: Smith targeted tests passed; local gateway tests passed (`9 passed`).

### Easy File-Output Run

- Gateway setting:

```sh
taskset -c 0,1 env \
  OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MKL_NUM_THREADS=2 NUMEXPR_NUM_THREADS=2 \
  VIBETHINKER_FORWARD_TOOLS=false \
  VIBETHINKER_RESPONSE_FORMAT=json_object \
  VIBETHINKER_DEFAULT_MAX_TOKENS=512 \
  VIBETHINKER_MAX_TOKENS=512 \
  VIBETHINKER_N_THREADS=2 \
  VIBETHINKER_N_CTX=8192 \
  VIBETHINKER_LOG_COMPLETIONS=true \
  python3 scripts/serve_gateway.py
```

- Passing command:

```sh
node bin/smith.js benchmark run ./benchmarks/001-release-note-summary \
  --agent opencode \
  --opencode-mode file-output \
  --model vibethinker-local/vibethinker-3b \
  --opencode-project /home/alextis/Work/Git/alextis59/local-opencode \
  --timeout-ms 240000 \
  --concurrency 1 \
  --log-dir /tmp/smith-vibethinker \
  --json
```

- Result: passed in `27943ms`; log `/tmp/smith-vibethinker/2026-06-16T21-47-11-911Z-opencode-001-release-note-summary.json`.
- Observed model behavior: returned JSON for `summary.md` with the exact source phrases `payments retry fix`, `mobile receipt copy`, and `rollback flag receipt_v2`.
- Stability: one gateway process pinned to two CPUs, about 3.9 GB RSS after load, no parallel inference.

### Progression Attempt: Code Fix

- Task: `benchmarks/011-parse-port-default`.
- Result: failed twice.
- Best observed behavior: model produced JSON and wrote `src/parse-port.js`, but still used `Number(value) || 3000`, which fails the `parsePort("0") === 0` assertion, and also tried to include `test.js` despite instructions.
- Decision: `file-output` mode is not yet satisfying for code-fix tasks with this model/settings.

### Progression Success: Medium Reporting Task

- Task: `benchmarks/003-incident-timeline` (`Difficulty: medium`).
- Passing command:

```sh
node bin/smith.js benchmark run ./benchmarks/003-incident-timeline \
  --agent opencode \
  --opencode-mode file-output \
  --model vibethinker-local/vibethinker-3b \
  --opencode-project /home/alextis/Work/Git/alextis59/local-opencode \
  --timeout-ms 240000 \
  --concurrency 1 \
  --log-dir /tmp/smith-vibethinker \
  --json
```

- Result: passed in `34867ms`; log `/tmp/smith-vibethinker/2026-06-16T21-51-13-830Z-opencode-003-incident-timeline.json`.
- Observed model behavior: returned JSON for `summary.md` and preserved the required phrases `Incident 1187`, `09:14 queue depth warning`, `09:22 worker restart`, and `root cause: missing index`.
- Recommended next setting: use `--opencode-mode file-output` for inspection/reporting benchmarks first; do not use the current VibeThinker/OpenCode tool-calling path for code-fix scoring until it can produce tool calls within the CPU-bound timeout.

### Continued Final Verification

- Commands:

```sh
npm run check
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest
pgrep -af 'opencode run|serve_gateway|local_opencode_gateway|uvicorn|python3 scripts/serve_gateway.py'
```

- Result: Smith passed `213` tests across `13` files; local-opencode passed `9` tests.
- Process state: the managed gateway was stopped after experiments; no `opencode run` or gateway process remained.
