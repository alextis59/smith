# SWE-bench Pro Goal Summary

Goal: improve Smith `gpt-5.4-mini` high on `swe-bench-pro` to at least the Codex CLI `gpt-5.4` high score in `LeaderBoard.md`: target `>=7/10`, without benchmark cheating.

## Current Baseline

- Target score: `>=7/10`.
- Leaderboard target reference: Codex CLI `gpt-5.4` high, `7/10`, raw result `.smith-bench/codex-gpt-5.4-high-swe-pro.json`.
- Latest recorded Smith mini high full run: `3/10`, raw result `.smith-bench/swe-pro-default128k-max240-20260522.json`.
- Latest Smith mini high passes: `002`, `004`, `007`.
- Latest Smith mini high failures: `001`, `003`, `005`, `006`, `008`, `009`, `010`.

## 2026-05-23 Milestone: Bounded SWE Docker Timeouts

Problem found:

- A targeted `001-nodebb-nodebb-vnan` rerun could exceed the configured `--timeout-ms 900000` and leave the Smith Docker container running.
- The failed benchmark result could have empty `stdout`/`stderr`, hiding the actual timeout or process state.
- Retained sandbox evidence from `.smith-bench/run-r8gQ0s` showed the NodeBB selected tests passed when manually verified, but the benchmark result had no verifier because the harness did not reach verifier execution.

Change:

- Route SWE Smith Docker runs and SWE verifier Docker runs through the spawn-based benchmark process runner.
- Add timeout cleanup hooks for Docker benchmark containers.
- Add fallback cleanup that inspects the Docker container host PID and sends `SIGKILL` when Docker `kill`/`rm -f` gets stuck.
- Preserve timeout/error messages when child `stderr` exists but is empty.
- Add focused regression coverage for spawn timeout cleanup hooks.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark: `benchmarks/091-command-router-refactor`, passed in `139193ms`, log `/tmp/smith/2026-05-23T09-13-38-873Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/001-nodebb-nodebb-vnan`, failed cleanly in `917343ms` with `stderr: docker timed out after 900000ms`, log `/tmp/smith/2026-05-23T09-29-06-389Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-BvlbFf/home/.smith/runs/2026-05-23T09-14-01-211Z.trace`.
- Post-run Docker check: no live `smith-bench-run-BvlbFf-smith` or other Smith benchmark container remained.

Next step:

- Diagnose why `001` spends the full edit budget despite a previous retained sandbox patch passing selected tests, then make a general improvement around long-task convergence, task memory, or patch reuse/recovery if supported by trace evidence.

## 2026-05-23 Milestone: Nudge SWE Tasks Toward Earlier Edits

Problem found:

- Clean timeout trace `.smith-bench/run-BvlbFf/home/.smith/runs/2026-05-23T09-14-01-211Z.trace` showed `001-nodebb-nodebb-vnan` spent the entire edit budget inspecting source, templates, public files, and docs without modifying tracked files.
- The retained workspace had only `?? appendonlydir/`, so the agent never reached the benchmark verifier with a candidate solution.

Change:

- Add a general SWE-bench Pro instruction to avoid spending the whole run on reconnaissance.
- The instruction tells the agent to inspect the task-named implementation files and nearest callers/tests, then make the smallest focused source edit before secondary UI, docs, generated, or localization inspection.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark: `benchmarks/091-command-router-refactor`, passed in `155828ms`, log `/tmp/smith/2026-05-23T09-35-32-623Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/001-nodebb-nodebb-vnan`, still failed cleanly in `913580ms` with `stderr: docker timed out after 900000ms`, log `/tmp/smith/2026-05-23T09-50-55-720Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-Q6JYma/home/.smith/runs/2026-05-23T09-35-49-467Z.trace`.
- The target rerun improved behavior from no tracked source edits to a six-file candidate patch across `src/user/email.js`, `src/controllers/admin/users.js`, `src/socket.io/admin/user.js`, and the three database adapter `main.js` files, but still timed out before testing or finish.

Rejected follow-up wording:

- A "run one narrow check then finish" instruction timed out on `001` with no tracked source edits, log `/tmp/smith/2026-05-23T10-11-54-020Z-smith-001-nodebb-nodebb-vnan.json`.
- More concrete Requirements/Interface checklist wording timed out on `001` with only `src/user/email.js` modified, log `/tmp/smith/2026-05-23T10-30-59-223Z-smith-001-nodebb-nodebb-vnan.json`.
- Both were removed because they were not better than the narrower reconnaissance instruction.

Next step:

- Inspect why the six-file candidate patch still did not trigger a narrow check or finish. A likely next general improvement is a loop or prompt mechanism that detects successful patches during SWE runs and biases the next turn toward targeted validation or finish instead of renewed broad discovery.
