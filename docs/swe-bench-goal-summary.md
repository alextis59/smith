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

## 2026-05-23 Milestone: Avoid Impossible Ripgrep Bootstrap In Benchmarks

Problem found:

- Benchmark editing containers often lack `rg`, and Smith spends startup model turns trying to install it.
- The containers run as the host UID, so package-manager installs such as `apt-get install ripgrep` predictably fail with permission errors.

Change:

- Add a benchmark-container `rg` fallback shim next to the existing Python shim when real `rg` is missing.
- Change Smith's startup `rg` availability probe from a login shell to a non-login shell so it respects the PATH inherited by the Smith process.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts tests/benchmark.test.ts`: passed.
- Project benchmark retry: `benchmarks/091-command-router-refactor`, passed in `163807ms`, log `/tmp/smith/2026-05-23T10-56-54-632Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/001-nodebb-nodebb-vnan`, still failed cleanly in `910861ms` with `stderr: docker timed out after 900000ms`, log `/tmp/smith/2026-05-23T11-12-16-084Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-ze9fjb/home/.smith/runs/2026-05-23T10-57-10-875Z.trace`.
- Target trace showed `ripgrep startup check available: true`, but the run still over-searched and made no tracked source edits.

Next step:

- Continue focusing on convergence after initial inspection. The `rg` shim removes wasted startup turns, but does not solve the main `001` failure mode.

## 2026-05-23 Milestone: Keep SWE Fixes Out Of Tests And Require Real Checks

Problem found:

- Baseline `006-navidrome` reached finish but failed verifier with missing/failed selected tests.
- Trace `.smith-bench/run-BxaF63/home/.smith/runs/2026-05-22T05-12-57-297Z.trace` showed the agent edited package test files and finished after grep-only symbol checks instead of running package tests.
- The task metadata setup restores selected test files before verification, so test edits are wasted and can mask compile/test failures.

Change:

- Add SWE-bench Pro instructions not to edit repository tests unless explicitly requested.
- Add SWE-bench Pro instructions that grep-only symbol checks are not enough after source edits; run the narrowest available compiler, package test, syntax, or static check before finish.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark: `benchmarks/091-command-router-refactor`, passed in `117509ms`, log `/tmp/smith/2026-05-23T11-17-36-784Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, passed in `853342ms`, log `/tmp/smith/2026-05-23T11-32-04-271Z-smith-006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e.json`, trace `.smith-bench/run-GaMHOM/home/.smith/runs/2026-05-23T11-18-14-788Z.trace`.

Next step:

- Re-evaluate remaining failed tasks. With `006` plausibly recovered, expected full-run score is at least `4/10` if previous passes remain stable; still short of the `>=7/10` target.

## 2026-05-23 Milestone: Run SWE Verifiers Through Bash Entrypoint

Problem found:

- Targeted `003-ansible` rerun produced a plausible source-only fix, but the external verifier failed before running tests.
- Docker stderr showed `exec: "-lc": executable file not found in $PATH`.
- The SWE verifier container path passed `-lc` directly to the task image without setting `bash` as the entrypoint, unlike the Smith editing container path.

Change:

- Add `buildSweBenchProVerifierDockerArgs()` and run SWE-bench Pro verifier containers with `--entrypoint bash`.
- Cover the verifier Docker argument shape in `tests/benchmark.test.ts`.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark retry: `benchmarks/091-command-router-refactor`, passed in `241403ms`, log `/tmp/smith/2026-05-23T11-55-31-941Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, passed in `678879ms`, log `/tmp/smith/2026-05-23T12-07-19-667Z-smith-003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5.json`, trace `.smith-bench/run-DH6Xqp/home/.smith/runs/2026-05-23T11-56-02-828Z.trace`.
- External verifier ran the selected Ansible tests and reported `{"passed": 175}`.

Next step:

- Continue with another previously failed task, likely `008` or `009`, before considering a full SWE-bench Pro run. With `003` and `006` plausibly recovered, expected score is around `5/10` if the original `002`, `004`, and `007` passes remain stable.

## 2026-05-23 Milestone: Recovered Vuls Trivy Parser Task 008

Evidence:

- Baseline `008` had a very long trace and edited `contrib/trivy/parser/v2/parser_test.go`, which the task setup restores before verification.
- With the current committed Smith instructions and verifier entrypoint fix, the targeted rerun kept the implementation in `contrib/trivy/pkg/converter.go` and reached the external verifier.

Validation:

- Target SWE rerun: `swe-bench-pro/008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904`, passed in `894296ms`, log `/tmp/smith/2026-05-23T12-24-39-065Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-r2NfP6/home/.smith/runs/2026-05-23T12-09-45-713Z.trace`.
- External verifier ran selected `TestParse` and reported `{"passed": 1}`.
- No new Smith code change was made for this milestone; it validates the earlier general prompt and harness fixes on another failed SWE task.

Next step:

- Target `009-internetarchive-openlibrary` next. If `009` is recovered, targeted evidence would reach about `7/10` and justify a full SWE-bench Pro rerun.
