# SWE-bench Pro Goal Worklog

This is the detailed working log for the long-running SWE-bench Pro improvement goal. It records evidence, hypotheses, failures, and rejected ideas. Do not use it to encode benchmark-instance hacks or hidden solutions.

## 2026-05-23 Initial Orientation

Read:

- `README.md`
- `docs/benchmarks.md`
- `docs/benchmark-iteration-notes.md`
- `LeaderBoard.md`
- `benchmark-datasets/swe-bench-pro/README.md`
- `prompts/system.txt`
- `src/benchmark/runner.ts`
- `src/loop.ts`
- `src/providers/tools.ts`
- Relevant tests: `tests/benchmark.test.ts`, `tests/prompt-trace.test.ts`, and search results across benchmark/prompt/tool/loop tests.

Baseline from `LeaderBoard.md`:

- Target: Codex CLI `gpt-5.4` high on `swe-bench-pro` passed `7/10`.
- Current Smith `gpt-5.4-mini` high full run: `3/10`, `.smith-bench/swe-pro-default128k-max240-20260522.json`.
- Passed: `002-qutebrowser`, `004-openlibrary`, `007-element-web`.
- Failed: `001-nodebb`, `003-ansible`, `005-teleport`, `006-navidrome`, `008-vuls`, `009-openlibrary`, `010-vuls`.

Existing code context:

- SWE Smith runs use task Docker images when possible, otherwise `node:22-bookworm`.
- The runner already marks `/app` as a safe Git directory before SWE verification.
- Existing prompt and benchmark instructions already include scoped search, exact literal preservation, patch-first editing, no premature finish, no verifier reading before first run, missing dependency handling, task memory, and sub-agent guidance.

## 2026-05-23 Evidence: NodeBB 001 Inconclusive Failure

Recent partial full-run artifacts:

- Log: `/tmp/smith/swe-full-20260523/2026-05-23T06-28-42-413Z-smith-001-nodebb-nodebb-vnan.json`.
- Sandbox: `.smith-bench/run-r8gQ0s`.
- Trace: `.smith-bench/run-r8gQ0s/home/.smith/runs/2026-05-23T05-49-14-621Z.trace`.
- Session log had `passed: false`, `stdout: ""`, `stderr: ""`, and no verifier.
- `home/benchmark-results/smith.status` was `0`.
- `home/benchmark-results/smith.stdout` contained a normal Smith JSON finish in 19 turns.

Manual verifier check on retained `.smith-bench/run-r8gQ0s`:

- Used the exact task Docker image from `task.json`: `jefzda/sweap-images:nodebb.nodebb-NodeBB__NodeBB-04998908ba6721d64eba79ae3b65a351dcfbc5b5`.
- Ran selected test file `test/user/emails.js`.
- NodeBB reported `16 passing`, no test failures.
- My ad hoc Python post-processing command had a shell quoting bug and exited nonzero after the test output, so the useful evidence is the Mocha JSON showing all selected tests passed.

Hypothesis:

- The Smith patch from `.smith-bench/run-r8gQ0s` is likely functionally good for selected tests, but the benchmark harness or outer process failed before verifier recording.

## 2026-05-23 Failed Official Rerun Before Fix

Command:

```sh
node bin/smith.js benchmark run swe-bench-pro/001-nodebb-nodebb-vnan --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --max-turns 240 --timeout-ms 900000 --keep-sandbox --log-dir /tmp/smith --provider-debug --json
```

Observed:

- Run exceeded the configured timeout and remained active.
- Process evidence showed the outer Node benchmark process, `docker run`, and inner Smith process still running after the timeout.
- `home/benchmark-results/smith.stdout` and `smith.stderr` were still empty.
- The trace had many tool calls and was waiting in the provider loop.
- Attempting to interrupt the outer process did not stop the child Docker/Smith process.
- Manual `docker kill` later returned `permission denied`; `docker rm -f` reported removal already in progress while the container still showed running.
- Inspecting the container host PID and sending `SIGKILL` to that PID cleared the stuck container.

Classification:

- SWE-bench Pro harness reliability issue.
- Error reporting issue: timeout errors with empty `stderr` were recorded as blank stderr because the runner preferred `failed.stderr` even when it was an empty string.
- Not a benchmark scoring or verifier issue.

Rejected ideas:

- Do not increase `--timeout-ms`; this would hide the harness defect and spend more benchmark time.
- Do not change task prompts, selected tests, parser, run script, or scoring.
- Do not add NodeBB-specific shortcuts based on the task id.

## 2026-05-23 Change: Timeout Cleanup and Error Reporting

Files changed:

- `src/benchmark/runner.ts`
- `tests/benchmark.test.ts`

Implementation notes:

- `runSmithForSweBenchProTask()` now uses `runDockerBenchmarkContainer()` instead of raw `execFileAsync("docker", ...)`.
- `runSweBenchProVerifier()` also uses `runDockerBenchmarkContainer()`.
- `runDockerBenchmarkContainer()` now uses the spawn-based runner with an `onTimeout` cleanup hook and short SIGKILL grace period.
- `cleanupDockerContainer()` now retries cleanup and falls back to `docker inspect --format {{.State.Pid}}` plus host `SIGKILL` when Docker kill/rm gets stuck.
- Added `errorStderr()` so empty child `stderr` no longer suppresses the actual timeout or error message.
- Exported `spawnFileWithInput()` and added a focused timeout-hook regression test without relying on flaky Docker daemon behavior.
- Hardened benchmark test HTTP server cleanup with `closeAllConnections()` when available.

Validation commands and outcomes:

```sh
npm test -- tests/benchmark.test.ts
```

Result: passed, 14 tests.

```sh
npm run build
```

Result: passed.

```sh
node bin/smith.js benchmark run benchmarks/091-command-router-refactor --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Result: passed in `139193ms`, 11 turns, verifier exit `0`. Log: `/tmp/smith/2026-05-23T09-13-38-873Z-smith-091-command-router-refactor.json`.

```sh
node bin/smith.js benchmark run swe-bench-pro/001-nodebb-nodebb-vnan --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --max-turns 240 --timeout-ms 900000 --keep-sandbox --log-dir /tmp/smith --provider-debug --json
```

Result: failed cleanly in `917343ms`. Important fields:

- `stderr`: `docker timed out after 900000ms`
- `tracePath`: `.smith-bench/run-BvlbFf/home/.smith/runs/2026-05-23T09-14-01-211Z.trace`
- `sandboxDir`: `.smith-bench/run-BvlbFf`
- `logPath`: `/tmp/smith/2026-05-23T09-29-06-389Z-smith-001-nodebb-nodebb-vnan.json`
- Usage: `783739` total tokens.

Post-run check:

- `docker ps --format '{{.Names}}' | rg 'smith-bench-run-BvlbFf-smith|smith-bench-run-.*-smith' || true` produced no output.

Decision:

- Commit this as a validated harness milestone because it makes expensive SWE iteration bounded and inspectable.
- It does not improve the score directly; it removes a blocker to evidence-driven iteration.

Next concrete investigation:

- Inspect `.smith-bench/run-BvlbFf` trace and workspace diff to understand why the current `001` rerun times out instead of converging like retained `.smith-bench/run-r8gQ0s`.
- Compare high-level behavior only; do not mine hidden tests or external patches.
- Candidate general improvements to evaluate from evidence: stronger task-memory updates before large edits, better patch recovery after broad edits, or bounded self-stop guidance for SWE tasks when enough implementation and static checks are complete.
