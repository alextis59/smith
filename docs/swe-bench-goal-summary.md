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

## 2026-05-23 Investigation: 009 Still Open

Evidence:

- Current committed Smith rerun of `009-internetarchive-openlibrary` failed with real verifier output: `56 passed`, `3 failed`, log `/tmp/smith/2026-05-23T12-39-30-991Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`.
- Failures were missing alternate `other_titles` for XML/binary MARC linkage cases and one hard exception for unresolved author linkage.
- A temporary fixture-inspection prompt experiment passed local validation but made 009 worse: it timed out before a MARC source patch, log `/tmp/smith/2026-05-23T12-58-33-464Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`.

Decision:

- Reverted the fixture-inspection prompt experiment.
- `009` remains failed; targeted evidence remains around `6/10`.

## 2026-05-23 Milestone: Constrain Go Edits Without Toolchain

Problem found:

- A `010-future-architect-vuls` rerun timed out after making a large Go hand rewrite and spending the end of the run chasing brace balance because the editing container had neither `go` nor `gofmt`.
- This was a general Go-task failure mode for SWE task images that do not support local Go checks in the editing container.

Change:

- Add a SWE-bench Pro instruction for Go tasks: when `go` or `gofmt` is unavailable, avoid broad hand rewrites, prefer localized edits to existing functions, and keep edited control-flow blocks small enough to inspect for balanced braces before finish.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark retry: `benchmarks/091-command-router-refactor`, passed in `209687ms`, log `/tmp/smith/2026-05-23T13-26-32-498Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`, still failed, but reached external verifier instead of timing out: log `/tmp/smith/2026-05-23T13-42-36-054Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-vSVTDK/home/.smith/runs/2026-05-23T13-26-44-309Z.trace`.
- Verifier failures narrowed to `TestIsOvalDefAffected`, `Test_alpine_parseApkInstalledList`, and `Test_alpine_parseApkIndex`.

Next step:

- Try the remaining Go failure `005` with the Go no-toolchain instruction. Targeted evidence is still around `6/10` until another failed task passes.

## 2026-05-23 Investigation: 005 Still Open

Evidence:

- Target SWE rerun: `swe-bench-pro/005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037`, failed by Docker timeout after `916774ms`.
- Log: `/tmp/smith/2026-05-23T13-59-39-797Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`.
- Trace: `.smith-bench/run-kEaSJ4/home/.smith/runs/2026-05-23T13-44-34-502Z.trace`.
- The retained workspace had no source patch; only `SMITH.TASK.md` was untracked. No verifier ran.

Classification:

- The Go no-toolchain instruction did not recover this task. The failure mode is earlier: broad reconnaissance in a large Go repository timed out before an implementation edit.
- Targeted evidence remains around `6/10`: original passes `002`, `004`, `007` plus recovered `003`, `006`, `008`.

Next step:

- Prefer another targeted recovery attempt on `009` or `010`, because both now reach verifier and expose concrete remaining failures. Do not run the full SWE-bench Pro benchmark yet.

## 2026-05-23 Milestone: Hide SWE Git History From Agents

Problem found:

- The 010 traces showed the agent using the commit-like suffix from the SWE instance ID to inspect the historical fix commit with `git show e6c0da6`.
- That is gold-patch leakage and cannot count as valid benchmark evidence, even though the task still failed.

Change:

- Stop including the SWE instance ID and base commit in the agent prompt.
- Add an explicit SWE instruction forbidding git history, refs, tags, instance IDs, directory-name hashes, or commit IDs as solution sources.
- Hide the workspace `.git` directory during Smith/Codex editing and restore it only before the SWE verifier, since verifier setup commands legitimately use git to restore selected tests.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Built CLI contains the anti-history instruction and no longer contains the removed instance/base-commit prompt text.
- Project benchmark: `benchmarks/091-command-router-refactor`, passed in `187387ms`, log `/tmp/smith/2026-05-23T14-28-03-129Z-smith-091-command-router-refactor.json`.
- Clean target SWE rerun: `swe-bench-pro/010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`, failed by Docker timeout after `906109ms`, log `/tmp/smith/2026-05-23T14-43-17-624Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-cU9DTs/home/.smith/runs/2026-05-23T14-28-12-210Z.trace`.
- Clean 010 prompt evidence showed no instance ID or base commit in the task prompt; trace search found no `git show`/historical-fix access beyond the new anti-history instruction text.

Next step:

- Keep full-run evidence at around `6/10` from uncontaminated targeted passes `003`, `006`, and `008` plus baseline `002`, `004`, and `007`.
- Continue with a non-history-based recovery attempt, likely `009` because it already reaches verifier without evidence of git-history leakage.

## 2026-05-23 Direction Update: Prioritize Codex-Passed Failures

User guidance:

- Do not focus too much on tasks that Codex `gpt-5.4` high failed, because some dataset tasks may be flawed.

Implication:

- Codex `gpt-5.4` high failed `003`, `006`, and `009`.
- The high-value Smith recovery targets are therefore `001`, `005`, and `010`, because Codex passed them and Smith `gpt-5.4-mini` high has not.
- The interrupted 009 retry is no longer a priority target.

Next step:

- Validate the current post-check stopping instruction on a Codex-passed failed task, preferably `010`, before considering any full SWE-bench Pro run.

## 2026-05-23 Rejected: Post-Check Stopping Prompt

Evidence:

- The post-check stopping instruction was motivated by a 009 timeout, but 009 is one of the Codex `gpt-5.4` high failed tasks.
- Validation on Codex-passed failed task `010` did not help: the target rerun failed by Docker timeout after `906003ms`, log `/tmp/smith/2026-05-23T15-27-00-507Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-tTNCqv/home/.smith/runs/2026-05-23T15-11-55-250Z.trace`.
- The retained workspace had only `scanner/alpine.go` changed; no verifier ran.

Decision:

- Reverted the post-check stopping instruction and its test assertion.
- Continue prioritizing Codex-passed Smith failures: `001`, `005`, and `010`.

## 2026-05-23 Policy Correction: Remove SWE-Specific Prompt Coaching

User guidance:

- Prompt edits made specifically for the SWE benchmark are considered cheating.
- Improvements must be generic and applicable to ordinary user tasks; SWE-specific runtime instructions should be discarded.

Change:

- Stopped an in-progress clean `001` rerun before result because it was using the SWE-specific prompt stack.
- Removed all `SWE_BENCH_PRO_TASK_INSTRUCTIONS`; SWE tasks now receive only the generic benchmark task framing.
- Kept `.git` hiding/restoration as harness integrity, not agent coaching: the agent cannot inspect historical solution commits, while verifier setup can still restore selected tests.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Verified removed SWE-specific prompt text is absent from `src/benchmark/runner.ts`, `dist/src/benchmark/runner.js`, and `tests/benchmark.test.ts`.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `136481ms`, log `/tmp/smith/2026-05-23T15-34-43-729Z-smith-091-command-router-refactor.json`.

Next step:

- Continue only with generic Smith/runtime improvements; do not add SWE-bench-specific prompt coaching.

## 2026-05-23 Clean 001 Rerun and Generic Context Control

Evidence:

- Clean target SWE rerun after removing SWE-specific prompt coaching: `swe-bench-pro/001-nodebb-nodebb-vnan`, failed by Docker timeout after `912420ms`.
- Log: `/tmp/smith/2026-05-23T15-50-52-739Z-smith-001-nodebb-nodebb-vnan.json`.
- Trace: `.smith-bench/run-EDqLzM/home/.smith/runs/2026-05-23T15-35-47-614Z.trace`.
- Retained workspace had no source diff; only `?? appendonlydir/`.
- Trace showed useful read-only reconnaissance, including delegated subsystem findings, but the parent continued broad inspection and did not patch before timeout.
- The trace was about `5.0MB`, with repeated large inspection outputs including irrelevant localization/search noise. This points to a generic context/tool-output control issue, not a SWE-specific prompt gap.

Generic change:

- Lower the default `runtime.max_tool_output_chars` from `24000` to `12000`.
- Apply the same output cap to `sub_agent` results before replaying them into the parent transcript/provider context.
- This is task-agnostic: it limits any oversized terminal or delegated-agent output while retaining the existing config/CLI override for users who need larger outputs.

Next step:

- Focused tests/build passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `207516ms`, log `/tmp/smith/2026-05-23T15-58-04-331Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-qbUAUm/home/.smith/runs/2026-05-23T15-54-37-143Z.trace`.
- Target SWE rerun `swe-bench-pro/001-nodebb-nodebb-vnan`: still failed by timeout in `912402ms`, log `/tmp/smith/2026-05-23T16-13-38-149Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-MB52aB/home/.smith/runs/2026-05-23T15-58-32-942Z.trace`.
- Comparison: previous clean 001 used `751556` total tokens and made no source edits; this run used `705656` total tokens and patched `src/user/email.js`, but did not complete the required adapter/controller changes or reach verifier.
- Keep the generic context-control change as a broad improvement, but do not count it as a SWE recovery.

Next step:

- Commit this validated generic milestone, then continue with another generic improvement or another Codex-passed target (`005` or `010`) rather than adding SWE-specific prompt instructions.

## 2026-05-23 Milestone: Improve Benchmark `rg` Fallback

Evidence:

- Clean `005` rerun under the generic runtime state failed by timeout in `914140ms`.
- Log: `/tmp/smith/2026-05-23T16-31-34-943Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`.
- Trace: `.smith-bench/run-04O9Su/home/.smith/runs/2026-05-23T16-16-29-705Z.trace`.
- Usage was very high: `1919285` total tokens.
- Retained workspace had no source diff.
- Trace showed the fallback `rg` shim failing on common ripgrep syntax, including `-g '*.go'` and regex alternation/group patterns, because it degraded to basic `grep` and misparsed glob arguments.

Generic change:

- Strengthen the benchmark `rg` shim to support `-g/--glob`, `--files`, common ignored flags, and extended regex matching.
- Add a regression test for the observed generic command shape: `rg -n -g '*.go' 'NewForwarder\\(|ServeHTTP' .`.

Next step:

- Project benchmark `benchmarks/091-command-router-refactor`: passed in `103128ms`, log `/tmp/smith/2026-05-23T16-35-57-920Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-mWVcYk/home/.smith/runs/2026-05-23T16-34-15-016Z.trace`.
- Target `005` rerun: still failed by timeout in `915469ms`, log `/tmp/smith/2026-05-23T16-51-23-963Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-FCnqs4/home/.smith/runs/2026-05-23T16-36-18-801Z.trace`.
- Comparison: no source diff in either 005 run, but total token use dropped from `1919285` to `642602`, trace size dropped from `11.3MB` to `4.8MB`, and the prior `grep`/`-g` shim errors were absent.
- Keep the shim improvement as a validated generic harness fix; do not count `005` as recovered.

Next step:

- Commit and push this milestone, then move to another generic bottleneck or another Codex-passed target (`010`) rather than further tuning `005`.
