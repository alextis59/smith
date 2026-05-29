# SWE-bench Pro Goal Summary

Goal: improve Smith `gpt-5.4-mini` high on `swe-bench-pro` to at least the Codex CLI `gpt-5.4` high score in `LeaderBoard.md`: target `>=7/10`, without benchmark cheating.

## Current Baseline

- Target score: `>=7/10`.
- Leaderboard target reference: Codex CLI `gpt-5.4` high, `7/10`, raw result `.smith-bench/codex-gpt-5.4-high-swe-pro.json`.
- Latest recorded Smith mini high full run: `3/10`, raw result `.smith-bench/swe-pro-default128k-max240-20260522.json`.
- Latest Smith mini high passes: `002`, `004`, `007`.
- Latest Smith mini high failures: `001`, `003`, `005`, `006`, `008`, `009`, `010`.
- Integrity correction: user clarified that prompt edits made specifically for the SWE benchmark are cheating for this goal. Earlier SWE-specific prompt milestones and any passes produced under them are retained below only as historical investigation notes, not valid target evidence.
- Current valid evidence should count only the baseline full-run passes plus results produced after `befac0f` removed SWE-specific prompt coaching and kept only generic Smith/runtime or harness-integrity changes.
- Stricter prompt rule: SWE-bench Pro tasks now receive the raw task prompt only, with no Smith benchmark wrapper or SWE-specific coaching. Local project benchmarks still keep their normal `/task/verify.sh` harness framing.
- Current strict targeted evidence: baseline full-run passes `002`, `004`, `007`, plus recovered `001`, `003`, and `008` under the raw-prompt path, for `6/10` evidence. `003` is still a Codex `gpt-5.4` failed task, so keep prioritizing Codex-passed Smith failures for further work.
- Current unrecovered Codex-passed Smith failures: `005` and `010`. Do not run the full SWE-bench Pro suite until generic changes recover one more Codex-passed failure to plausibly reach `>=7/10`.
- User clarification on 2026-05-23: do not pursue prompt edits or instructions tailored to SWE-bench Pro. Generic Smith capabilities are acceptable only when they apply to ordinary user tasks as well.
- User reinforcement on 2026-05-23: prompt or runtime instructions written specifically for SWE-bench Pro are cheating for this goal. Treat the older SWE-specific prompt sections below as rejected historical experiments only; do not count their scores, reintroduce their wording, or use them as design direction.
- User reinforcement on 2026-05-24: benchmark-shaped prompt edits are cheating even when they look like general benchmark guidance. Future changes must be ordinary Smith improvements that would be appropriate for user tasks outside SWE-bench Pro.
- User reinforcement on 2026-05-24: anything done specifically for the SWE benchmark, including prompt edits or runtime instructions tuned to benchmark shape, must be discarded. Valid work must be generic Smith behavior that would be appropriate for ordinary user tasks.

## Maintenance Notes

- `.smith-bench` grows quickly because many targeted runs keep full sandboxes, traces, and result artifacts. Periodically check its size with `du -sh .smith-bench` and the retained run count with `find .smith-bench -maxdepth 1 -type d -name 'run-*' | wc -l`.
- After each useful failure has its command, log path, trace path, sandbox id, and relevant evidence copied into this summary/worklog, prune stale `.smith-bench/run-*` sandboxes that are no longer needed for diagnosis. Keep the raw result JSONs and any sandboxes that still contain unresolved evidence.
- Do not let cleanup remove artifacts referenced by `LeaderBoard.md`, current milestone evidence, or active target-task diagnosis.
- 2026-05-29 note: after the latest targeted runs, `.smith-bench` is about `20G` with `23` retained `run-*` directories. Before starting another long target sequence, review and prune stale retained sandboxes whose evidence has already been copied into these logs.

## 2026-05-29 Milestone: Require External Blockers For Incomplete Requirement Finishes

Problem found:

- Target `005-gravitational-teleport` reached a finish that explicitly reported incomplete requested work while `run` and `patch` avenues still existed.
- The existing explicit-requirements finish guard accepted generic phrases such as "could not" as a concrete blocker, even when the message really meant more source refactoring remained.
- This is a generic task-integrity issue: when a prompt has explicit requirements, Smith should not stop with incomplete items unless the blocker is external to the implementation work, such as a missing dependency, access issue, environment limit, or required user input.

Change:

- Tightened incomplete-requirements finish rejection in `src/loop.ts` so "concrete blocker" means a concrete external/environment/access/dependency/user-input blocker, not ordinary remaining implementation work.
- Added integration coverage for a non-external partial blocker on a prompt with explicit requirements.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "explicit requirements"`: passed `3` selected tests after rebuild.
- `npm test -- tests/integration.test.ts`: passed `66` tests.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `107197ms`, log `/tmp/smith/2026-05-29T18-42-43-976Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-suFFM5/home/.smith/runs/2026-05-29T18-40-57-072Z.trace`.

Target evidence:

- Pre-change diagnostic `005`: failed verifier in `738331ms`, log `/tmp/smith/2026-05-29T18-36-24-835Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-eCJp3v/home/.smith/runs/2026-05-29T18-24-13-431Z.trace`.
- Pre-change final message reported partial/incomplete work while local validation had passed against modified/staged tests; external verifier restored/used selected tests and failed on missing `Forwarder.cfg` and `Forwarder.clientCredentials` compatibility.
- Post-change `005`: failed verifier in `838850ms`, log `/tmp/smith/2026-05-29T18-56-50-927Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-RGo0gx/home/.smith/runs/2026-05-29T18-42-56-393Z.trace`.
- The stricter guard changed behavior from an early partial/incomplete finish to continued work until the run budget was exhausted. The final external verifier still failed on missing `Forwarder.cfg` and `Forwarder.clientCredentials` compatibility.

Decision:

- Keep the change because it closes a generic false-finish path and passed focused/full integration plus the representative project benchmark.
- Do not count `005` as recovered. Current strict evidence remains `6/10`; full SWE-bench Pro is still not justified.
- Next direction: investigate a generic way to keep validation honest when test files are modified but the user did not request test edits, without adding SWE-specific or benchmark-specific instructions.

## 2026-05-29 Milestone: Keep Validation Pending With Unrequested Dirty Tests

Problem found:

- `005-gravitational-teleport` repeatedly left `lib/kube/proxy/forwarder_test.go` modified/staged while local validation appeared successful, but the external verifier still failed against selected tests with missing source compatibility fields.
- Smith already warned about dirty tests in some source-patch paths, but validation could still be treated as complete when the pending patch set was only test files.

Change:

- Passing validation no longer clears a pending task patch when test files are modified or untracked and the user did not explicitly ask to edit tests.
- Added integration coverage for the only-test-files case.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "unrequested test files"`: passed.
- `npm test -- tests/integration.test.ts`: passed `67` tests.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `160714ms`, log `/tmp/smith/2026-05-29T19-03-54-035Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-3GjAim/home/.smith/runs/2026-05-29T19-01-13-555Z.trace`.

Target evidence:

- Target `005` still failed verifier in `869307ms`, log `/tmp/smith/2026-05-29T19-18-30-598Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-asx8SW/home/.smith/runs/2026-05-29T19-04-09-552Z.trace`.
- Retained workspace still had staged `lib/kube/proxy/forwarder_test.go` changes and source changes in `lib/kube/proxy/forwarder.go` / `lib/service/kubernetes.go`.
- Trace search did not find the new dirty-test validation warning, so this change did not address the observed `005` path. The next generic direction is finish-time dirty-test detection, not more task-specific guidance.

Decision:

- Keep the change as a generic validation-integrity fix covered by tests and local benchmark validation.
- Do not count `005` as recovered. Current strict evidence remains `6/10`; full SWE-bench Pro is still not justified.

## 2026-05-29 Milestone: Reject Completion Claims With Dirty Unrequested Tests

Problem found:

- The previous validation guard only handled dirty tests after validation commands. A model could still finish with a completion/validation claim while test files were dirty.

Change:

- Before accepting a finish claim, Smith checks current git status for dirty test/spec files when the user did not explicitly ask to edit tests.
- If tests are dirty and the finish message claims completion or validation without acknowledging pending validation, Smith rejects the finish and asks for restoring tests, preserving existing compatibility, or reporting a pending/blocker state.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "unrequested test files|completion finishes"`: passed `2` selected tests after expectation updates.
- `npm test -- tests/integration.test.ts`: passed `68` tests.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `104433ms`, log `/tmp/smith/2026-05-29T19-27-18-883Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-nFzl3f/home/.smith/runs/2026-05-29T19-25-34-689Z.trace`.

Target evidence:

- Target `005` failed by Docker timeout after `912286ms`, log `/tmp/smith/2026-05-29T19-42-41-728Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-TA29B0/home/.smith/runs/2026-05-29T19-27-36-353Z.trace`.
- No verifier ran. Retained workspace only had source changes in `lib/kube/proxy/forwarder.go`; no dirty test files remained, so the new dirty-test finish guard did not fire.

Decision:

- Keep the change as a generic finish-integrity guard.
- Do not count `005` as recovered. Current strict evidence remains `6/10`; full SWE-bench Pro is still not justified.

## 2026-05-29 Milestone: Reject Heredoc Source Rewrites Through Run

Problem found:

- Diagnostic `010-future-architect-vuls` showed Smith rewriting `scanner/alpine.go` via `cat > scanner/alpine.go <<EOF`.
- In the interactive PTY, tab-heavy heredoc content triggered shell completion artifacts and directory listings inside the source file, corrupting code and wasting the run.

Change:

- Reject likely `cat > file <<EOF` heredoc file rewrites in the `run` tool and direct Smith to use `patch` for file edits.
- Added integration coverage that verifies a heredoc rewrite is rejected and a subsequent `patch` edit succeeds.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "heredoc file rewrites"`: passed.
- `npm test -- tests/integration.test.ts`: passed `69` tests.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `123962ms`, log `/tmp/smith/2026-05-29T20-05-17-800Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-SEpBif/home/.smith/runs/2026-05-29T20-03-14-278Z.trace`.

Target evidence:

- Pre-change `010`: failed by Docker timeout after `906345ms`, log `/tmp/smith/2026-05-29T20-00-19-061Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-1zl86m/home/.smith/runs/2026-05-29T19-45-13-539Z.trace`.
- Pre-change trace showed the corrupted heredoc rewrite and retained `scanner/alpine.go` had `376` changed lines.
- Post-change `010`: failed by Docker timeout after `905967ms`, log `/tmp/smith/2026-05-29T20-20-34-816Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-6goAJU/home/.smith/runs/2026-05-29T20-05-29-607Z.trace`.
- Post-change trace showed repeated `Run command rejected: heredoc-style file rewrites` messages, and the retained source diff was smaller and no longer polluted by shell completion listings.
- The target still timed out after later validation failures in `scanner/alpine.go`; no verifier ran.

Decision:

- Keep the change as a generic source-edit safety improvement.
- Do not count `010` as recovered. Current strict evidence remains `6/10`; full SWE-bench Pro is still not justified.

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

## 2026-05-23 Rejected Experiment: SWE-Specific Earlier-Edit Prompt

Problem found:

- Clean timeout trace `.smith-bench/run-BvlbFf/home/.smith/runs/2026-05-23T09-14-01-211Z.trace` showed `001-nodebb-nodebb-vnan` spent the entire edit budget inspecting source, templates, public files, and docs without modifying tracked files.
- The retained workspace had only `?? appendonlydir/`, so the agent never reached the benchmark verifier with a candidate solution.

Change later discarded:

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

Decision:

- Discard this instruction and do not use it as future design direction. Any future convergence work must live in generic Smith loop/tool behavior and apply to ordinary user tasks, not as SWE-bench prompt coaching.

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

## 2026-05-23 Historical Dead End: SWE-Specific Test/Check Prompt

Problem found:

- Baseline `006-navidrome` reached finish but failed verifier with missing/failed selected tests.
- Trace `.smith-bench/run-BxaF63/home/.smith/runs/2026-05-22T05-12-57-297Z.trace` showed the agent edited package test files and finished after grep-only symbol checks instead of running package tests.
- The task metadata setup restores selected test files before verification, so test edits are wasted and can mask compile/test failures.

Change later discarded:

- Add SWE-bench Pro instructions not to edit repository tests unless explicitly requested.
- Add SWE-bench Pro instructions that grep-only symbol checks are not enough after source edits; run the narrowest available compiler, package test, syntax, or static check before finish.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark: `benchmarks/091-command-router-refactor`, passed in `117509ms`, log `/tmp/smith/2026-05-23T11-17-36-784Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, passed in `853342ms`, log `/tmp/smith/2026-05-23T11-32-04-271Z-smith-006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e.json`, trace `.smith-bench/run-GaMHOM/home/.smith/runs/2026-05-23T11-18-14-788Z.trace`.

Next step:

- Do not count this `006` pass as valid target evidence because it depended on SWE-specific prompt coaching. Re-evaluate using generic Smith changes only if `006` becomes a priority.

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

## 2026-05-23 Historical Dead End: Prompt-Aided Vuls 008 Pass

Evidence:

- Baseline `008` had a very long trace and edited `contrib/trivy/parser/v2/parser_test.go`, which the task setup restores before verification.
- With the current committed Smith instructions and verifier entrypoint fix, the targeted rerun kept the implementation in `contrib/trivy/pkg/converter.go` and reached the external verifier.

Validation:

- Target SWE rerun: `swe-bench-pro/008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904`, passed in `894296ms`, log `/tmp/smith/2026-05-23T12-24-39-065Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-r2NfP6/home/.smith/runs/2026-05-23T12-09-45-713Z.trace`.
- External verifier ran selected `TestParse` and reported `{"passed": 1}`.
- No new Smith code change was made for this milestone; it validates the earlier general prompt and harness fixes on another failed SWE task.

Next step:

- Do not count this `008` pass as valid target evidence because it was produced before the prompt cleanup. Clean revalidation later failed under generic-only prompting.

## 2026-05-23 Investigation: 009 Still Open

Evidence:

- Current committed Smith rerun of `009-internetarchive-openlibrary` failed with real verifier output: `56 passed`, `3 failed`, log `/tmp/smith/2026-05-23T12-39-30-991Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`.
- Failures were missing alternate `other_titles` for XML/binary MARC linkage cases and one hard exception for unresolved author linkage.
- A temporary fixture-inspection prompt experiment passed local validation but made 009 worse: it timed out before a MARC source patch, log `/tmp/smith/2026-05-23T12-58-33-464Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`.

Decision:

- Reverted the fixture-inspection prompt experiment.
- `009` remains failed; targeted evidence remains around `6/10`.

## 2026-05-23 Historical Dead End: SWE-Specific Go No-Toolchain Prompt

Problem found:

- A `010-future-architect-vuls` rerun timed out after making a large Go hand rewrite and spending the end of the run chasing brace balance because the editing container had neither `go` nor `gofmt`.
- This was a general Go-task failure mode for SWE task images that do not support local Go checks in the editing container.

Change later discarded:

- Add a SWE-bench Pro instruction for Go tasks: when `go` or `gofmt` is unavailable, avoid broad hand rewrites, prefer localized edits to existing functions, and keep edited control-flow blocks small enough to inspect for balanced braces before finish.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Project benchmark retry: `benchmarks/091-command-router-refactor`, passed in `209687ms`, log `/tmp/smith/2026-05-23T13-26-32-498Z-smith-091-command-router-refactor.json`.
- Target SWE rerun: `swe-bench-pro/010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`, still failed, but reached external verifier instead of timing out: log `/tmp/smith/2026-05-23T13-42-36-054Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-vSVTDK/home/.smith/runs/2026-05-23T13-26-44-309Z.trace`.
- Verifier failures narrowed to `TestIsOvalDefAffected`, `Test_alpine_parseApkInstalledList`, and `Test_alpine_parseApkIndex`.

Next step:

- Do not count any improvement from this instruction as valid target evidence. Keep looking for generic runtime/tool changes instead.

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

## 2026-05-23 Milestone: Hide Benchmark Git History From Editing Agents

Problem found:

- The 010 traces showed the agent using the commit-like suffix from the SWE instance ID to inspect the historical fix commit with `git show e6c0da6`.
- That is gold-patch leakage and cannot count as valid benchmark evidence, even though the task still failed.

Change:

- Stop including the SWE instance ID and base commit in the agent prompt.
- Hide the workspace `.git` directory during Smith/Codex editing and restore it only before the verifier, since setup commands legitimately use git to restore selected tests.
- Earlier prompt wording that explicitly coached SWE-bench agents about history usage has been discarded under the stricter user policy; only the generic benchmark-integrity control remains valid.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed.
- `npm run build`: passed.
- Built CLI no longer contains the removed instance/base-commit prompt text.
- Project benchmark: `benchmarks/091-command-router-refactor`, passed in `187387ms`, log `/tmp/smith/2026-05-23T14-28-03-129Z-smith-091-command-router-refactor.json`.
- Clean target SWE rerun: `swe-bench-pro/010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`, failed by Docker timeout after `906109ms`, log `/tmp/smith/2026-05-23T14-43-17-624Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-cU9DTs/home/.smith/runs/2026-05-23T14-28-12-210Z.trace`.
- Clean 010 prompt evidence showed no instance ID or base commit in the task prompt; trace search found no `git show`/historical-fix access beyond the now-discarded anti-history instruction text.

Historical next step, later superseded by the stricter prompt rule:

- At this point the logs treated targeted passes `003`, `006`, and `008` as plausible evidence, but the later user clarification invalidated SWE-specific prompt-aided results unless revalidated under the raw SWE prompt path.
- Do not count this estimate as current valid evidence.

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
- Removed all `SWE_BENCH_PRO_TASK_INSTRUCTIONS`; SWE tasks now receive raw task text with no benchmark task framing.
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

## 2026-05-23 Clean 010 Evidence Under Generic Fixes

Evidence:

- Target `010` rerun with current cleaned prompt and generic fixes still failed by timeout in `905913ms`.
- Log: `/tmp/smith/2026-05-23T17-07-52-559Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`.
- Trace: `.smith-bench/run-cliA0l/home/.smith/runs/2026-05-23T16-52-47-371Z.trace`.
- Usage: `538210` total tokens.
- Retained workspace had no tracked source changes.
- Trace search showed no `git show`/history-solution access; `.git` hiding remains effective.

Current status:

- Clean, non-cheating targeted evidence currently supports only the baseline full-run passes `002`, `004`, and `007`.
- Codex-passed Smith failures `001`, `005`, and `010` remain unrecovered under generic changes.

Next step:

- Record this evidence, then look for another broad runtime/tool issue. Do not add benchmark-specific prompt instructions.

## 2026-05-23 Rejected/Inconclusive: Fresh Sub-Agent Context

Experiment:

- Reran `010` with `--no-sub-agent-inherit-context` to test whether fresh delegated agents reduce context cost and improve action.
- Result: still failed by timeout in `905995ms`.
- Log: `/tmp/smith/2026-05-23T17-25-16-099Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`.
- Trace: `.smith-bench/run-nlQdn5/home/.smith/runs/2026-05-23T17-10-10-875Z.trace`.
- Usage dropped only modestly from `538210` to `501664` total tokens and retained workspace still had no tracked source changes.

Decision:

- Do not change the default `sub_agent_inherit_context` based on this evidence.
- Continue with generic runtime/tool improvements only.

## 2026-05-23 Clean 008 Revalidation Failed

Evidence:

- Target `008` rerun after removing SWE-specific prompt coaching failed by Docker timeout in `906182ms`.
- Log: `/tmp/smith/2026-05-23T17-41-28-713Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`.
- Trace: `.smith-bench/run-lohmzj/home/.smith/runs/2026-05-23T17-26-23-635Z.trace`.
- Usage: `1631919` total tokens.
- Retained workspace changed `contrib/trivy/pkg/converter.go`, added untracked `contrib/trivy/parser/v2/merge_test.go`, and left `SMITH.TASK.md`; no verifier ran.

Decision:

- The earlier `008` pass is invalid target evidence under the user's benchmark-integrity rule because it occurred before SWE-specific prompt coaching was removed.
- Current clean evidence remains `3/10` from the previous full-run baseline until generic changes recover additional tasks.
- Next work should investigate generic task-memory or act-after-inspection behavior without benchmark-specific instructions.

## 2026-05-23 Generic Provider Timeout

Evidence:

- The prior clean `008` trace ended with a provider-side disconnect/reset before headers near the end of the run, and Smith had no model-call timeout separate from shell command timeouts.
- This is a generic reliability issue: a stalled provider attempt can consume an entire long-running Smith task.

Generic change:

- Added `runtime.provider_timeout_ms` and `--provider-timeout-ms`.
- Each provider attempt is now bounded, aborts its fetch signal on timeout, and flows through existing transient provider retry handling.
- Default is `300000ms`; `0` disables the timeout.

Validation:

- `npm test -- tests/providers.test.ts tests/config.test.ts`: passed `25` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `97984ms`, log `/tmp/smith/2026-05-23T17-51-02-052Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `008`: failed by Docker timeout in `905936ms`, log `/tmp/smith/2026-05-23T18-06-19-919Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-zp1tyt/home/.smith/runs/2026-05-23T17-51-14-751Z.trace`.
- The 008 retained workspace had no tracked source diff, only `SMITH.TASK.md`; trace search found no `provider request timed out` evidence before the outer Docker timeout.

Decision:

- Keep the change as generic provider reliability, but do not count it as SWE recovery evidence.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Generic Sub-Agent Turn Cap

Evidence:

- Clean `005` after the `rg` shim used a long read-only sub-agent but still ended with no tracked source changes.
- With `--max-turns 240`, sub-agents inherited too much of the parent budget for scoped reconnaissance.

Generic change:

- Added `runtime.sub_agent_max_turns` and `--sub-agent-max-turns`.
- Default cap is `12`; setting it to `0` restores full parent-budget inheritance.
- Updated the system prompt only to describe the generic bounded child-run behavior.

Validation:

- `npm test -- tests/config.test.ts tests/integration.test.ts tests/prompt-trace.test.ts`: passed `34` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `114065ms`, log `/tmp/smith/2026-05-23T18-13-25-823Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `005`: failed by Docker timeout in `911134ms`, log `/tmp/smith/2026-05-23T18-28-43-427Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-Z1HvqB/home/.smith/runs/2026-05-23T18-13-38-136Z.trace`.
- Target `005` did improve from no tracked source diff to a partial `lib/kube/proxy/forwarder.go` patch; sub-agents finished in `6` and `2` turns.
- Token use worsened to `2111572` total tokens, and no verifier ran.

Decision:

- Keep as a generic, configurable runtime improvement because it bounded delegated reconnaissance and helped `005` reach a source patch.
- Do not count `005` as recovered.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Integrity Cleanup: Raw SWE Prompts Only

User clarification:

- Any prompt or instruction change specifically aimed at SWE-bench Pro behavior is cheating for this goal.
- Generic Smith improvements are still allowed only when they apply to ordinary user tasks too.

Change:

- SWE-bench Pro task prompts now use the raw task text only.
- Removed inherited generic benchmark wrapper instructions from the SWE prompt path, including source-target nudges and benchmark verifier framing.
- Added a regression test that the SWE container script does not include benchmark wrapper text.
- Local `benchmarks/` tasks are unchanged because they are authored around the local `/task/verify.sh` harness.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed `18` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `102422ms`, log `/tmp/smith/2026-05-23T18-36-02-905Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `005-gravitational-teleport`: failed by Docker timeout in `911033ms`, log `/tmp/smith/2026-05-23T18-51-20-140Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-thu0Df/home/.smith/runs/2026-05-23T18-36-14-879Z.trace`.
- Retained `005` workspace had no tracked or untracked source diff.
- Trace search found no benchmark wrapper text such as `Complete this benchmark task`, `primary source-code targets`, `/task/verify.sh`, or `run the verifier directly`.
- Docker cleanup left no live Smith benchmark container.

Decision:

- This is an integrity cleanup, not a score improvement.
- Current valid score evidence remains `3/10`.
- Resume only with generic runtime/tool/harness changes and prioritize Codex-passed Smith failures such as `001`, `005`, and `010`.

## 2026-05-23 Rejected: Lower Tool Output Cap To 8000

Experiment:

- Lowered the generic default `runtime.max_tool_output_chars` from `12000` to `8000` after raw-prompt `005` showed repeated large source reads and no patch.

Validation:

- `npm test -- tests/config.test.ts tests/integration.test.ts`: passed `26` tests after fixing the CLI fixture.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `126625ms`, log `/tmp/smith/2026-05-23T18-57-24-449Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `005-gravitational-teleport`: failed by Docker timeout in `911447ms`, log `/tmp/smith/2026-05-23T19-12-42-298Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-t7TeZd/home/.smith/runs/2026-05-23T18-57-37-047Z.trace`.
- Retained `005` workspace had no tracked or untracked source diff.
- Usage worsened from the raw-prompt baseline `2984214` total tokens to `3157661` total tokens.
- Trace search found no benchmark wrapper text and Docker cleanup left no live Smith benchmark container.

Decision:

- Reverted the cap change; `12000` remains the default.
- Do not count this as a recovery.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Raw-Prompt 001 Revalidation Failed

Evidence:

- Target SWE rerun `001-nodebb-nodebb-vnan` under the raw SWE prompt path failed by Docker timeout in `918355ms`.
- Log: `/tmp/smith/2026-05-23T19-29-51-286Z-smith-001-nodebb-nodebb-vnan.json`.
- Trace: `.smith-bench/run-mZoSKB/home/.smith/runs/2026-05-23T19-14-46-118Z.trace`.
- Usage: `755880` total tokens.
- Session log recorded `34` model-selected tool calls.
- Retained workspace had no tracked source diff; only `?? appendonlydir/`.
- Trace search found no benchmark wrapper text and Docker cleanup left no live Smith benchmark container.

Decision:

- `001` remains unrecovered under the strict prompt rule.
- Failure class is generic no-edit reconnaissance churn after useful read-only sub-agent findings.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Raw-Prompt 010 Revalidation Failed

Evidence:

- Target SWE rerun `010-future-architect-vuls` under the raw SWE prompt path failed by Docker timeout in `906159ms`.
- Log: `/tmp/smith/2026-05-23T19-46-13-204Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`.
- Trace: `.smith-bench/run-ZSnre0/home/.smith/runs/2026-05-23T19-31-08-064Z.trace`.
- Usage: `728971` total tokens.
- Session log recorded `33` model-selected tool calls.
- Retained workspace had no tracked source diff; only `?? SMITH.TASK.md`.
- Trace search found no benchmark wrapper text and Docker cleanup left no live Smith benchmark container.

Decision:

- `010` remains unrecovered under the strict prompt rule.
- Failure class again looks like generic no-edit reconnaissance churn after useful local notes.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Rejected: Generic Reconnaissance Prompt Nudge

Experiment:

- Added one generic system-prompt sentence telling Smith not to let reconnaissance defer implementation edits indefinitely once a likely working set and plausible change are known.
- This was not SWE-specific, but it was still treated as needing evidence because the user explicitly objected to benchmark-targeted prompt work.

Validation:

- `npm test -- tests/prompt-trace.test.ts`: passed `8` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `198861ms`, log `/tmp/smith/2026-05-23T19-51-29-234Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `001-nodebb-nodebb-vnan`: failed by Docker timeout in `920646ms`, log `/tmp/smith/2026-05-23T20-06-57-216Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-lxCg4J/home/.smith/runs/2026-05-23T19-51-52-054Z.trace`.
- Retained `001` workspace still had no tracked source diff; only `?? appendonlydir/`.
- Usage worsened from the prior raw-prompt `001` baseline `755880` total tokens to `985393` total tokens.

Decision:

- Reverted the prompt change.
- Do not count this as a recovery.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Milestone: Generic Sub-agent Opt-out

Change:

- Added `runtime.sub_agent_enabled` with default `true`.
- Added `--no-sub-agent` / `--sub-agent` CLI overrides.
- When disabled, Smith removes the `sub_agent` provider tool and adds a generic runtime note that the work should be completed directly with the available tools.
- Updated README/provider config docs and config/integration/CLI tests.

Validation:

- `npm test -- tests/config.test.ts tests/integration.test.ts tests/cli.test.ts tests/prompt-trace.test.ts tests/danger-review.test.ts`: passed `48` tests.
- `npm run build`: passed.
- Project benchmark with `--no-sub-agent`: `benchmarks/091-command-router-refactor`, passed in `76903ms`, log `/tmp/smith/2026-05-23T20-16-40-980Z-smith-091-command-router-refactor.json`.

Target SWE evidence:

- Target SWE rerun with `--no-sub-agent`: `001-nodebb-nodebb-vnan`, failed by Docker timeout in `919493ms`, log `/tmp/smith/2026-05-23T20-32-06-767Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-u9SkCw/home/.smith/runs/2026-05-23T20-17-00-660Z.trace`.
- Usage: `1151741` total tokens.
- Workspace had no tracked source diff; only `?? appendonlydir/`.
- The trace had no benchmark wrapper text and no live Smith benchmark container remained after cleanup.

Decision:

- Keep the flag as a generic user-facing runtime control with default behavior unchanged.
- Do not use the `001` result as a recovery; disabling sub-agents did not improve this failure mode and worsened usage compared with the raw-prompt baseline.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Milestone: Generic Progress Reminder

Change:

- Added a generic runtime progress observation after `12` consecutive tool calls without a patch or finish.
- The reminder reports tool-call count, current turn, max turns, and available tools.
- In read-only or patch-unavailable runs, it asks for a finish when findings are sufficient; otherwise it notes that `patch` is available when a safe edit is identified.
- This is task-agnostic runtime feedback, not SWE-bench-specific prompt text.

Validation:

- `npm test -- tests/integration.test.ts tests/prompt-trace.test.ts`: passed `25` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `160683ms`, log `/tmp/smith/2026-05-23T20-41-20-090Z-smith-091-command-router-refactor.json`.

Target SWE evidence:

- Target SWE rerun `010-future-architect-vuls`: failed verifier, not timeout, in `999124ms`, log `/tmp/smith/2026-05-23T20-58-18-507Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-hnvwNA/home/.smith/runs/2026-05-23T20-41-40-688Z.trace`.
- Usage: `1957654` total tokens.
- Model-selected tool calls: `44` `run`, `5` `patch`, `4` `finish`, `3` `sub_agent`.
- Retained workspace had source changes in `scanner/alpine.go`, plus staged/working test edits from the agent in `scanner/alpine_test.go` and `oval/util_test.go`, and untracked `SMITH.md`.
- Official verifier ran and failed with scanner build errors for undefined test helper methods and one `TestIsOvalDefAffected` assertion.
- Trace search found the generic progress reminder and no benchmark wrapper text or SWE-specific coaching.

Decision:

- Keep the runtime reminder as a generic improvement: it moved `010` from no tracked source diff and Docker timeout to source patches, `finish`, and official verifier evidence.
- Do not count `010` as recovered.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Milestone: Task-image Smith Smoke Probe

Change:

- Relaxed SWE-bench Pro task-image selection to use the actual Smith smoke command as the compatibility check.
- The runner still requires `node` and `node /smith/bin/smith.js --version` to succeed inside the task image, but it no longer rejects task images solely because Node is below version 20.
- This is a generic benchmark harness reliability change: when an image can run Smith, Smith gets access to that image's project toolchains during the edit loop.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed `19` tests.
- `npm run build`: passed.
- Direct smoke against the Vuls task image confirmed `node /smith/bin/smith.js --version` succeeds and `/usr/local/go/bin/go` is available.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `91475ms`, log `/tmp/smith/2026-05-23T21-07-26-130Z-smith-091-command-router-refactor.json`.

Target SWE evidence:

- Target SWE rerun `010-future-architect-vuls`: failed verifier in `968317ms`, log `/tmp/smith/2026-05-23T21-23-45-663Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-A6GWng/home/.smith/runs/2026-05-23T21-07-38-310Z.trace`.
- Host process evidence showed the edit loop ran in `jefzda/sweap-images:future-architect.vuls-future-architect__vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`, not `node:22-bookworm`.
- Smith ran local Go checks in the edit loop, including `go test ./scanner -run 'TestParseApk' -count=1` and `go test ./scanner -count=1`.
- The official verifier still failed after restoring selected tests, with undefined `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList` methods in restored `scanner/alpine_test.go`, plus a `TestIsOvalDefAffected` assertion.

Decision:

- Keep the task-image smoke-probe change: it gives ordinary SWE/project task runs access to project toolchains whenever the image can actually launch Smith.
- Do not count `010` as recovered.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Rejected Experiment: Test-file Patch Note

User clarification:

- Prompt edits or runtime instructions motivated by SWE-bench Pro behavior are not acceptable for this goal unless they are genuinely generic Smith improvements applicable to ordinary user tasks.
- The active rule is stricter than earlier work: SWE-bench Pro tasks must receive raw task text only, with no task-solving coaching layered around the benchmark prompt.

Evidence and decision:

- A trial generic patch-output note warned after patches to likely test files. It was motivated by `010` verifier behavior where edited tests masked restored-test failures, so it was too close to SWE-specific coaching.
- Focused validation before rejection: `npm test -- tests/integration.test.ts` passed, `npm run build` passed, and `benchmarks/091-command-router-refactor` passed in `96376ms`, log `/tmp/smith/2026-05-23T21-28-28-448Z-smith-091-command-router-refactor.json`.
- Target rerun `010-future-architect-vuls` failed by Docker timeout in `907289ms`, log `/tmp/smith/2026-05-23T21-43-51-756Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-9BOGIw/home/.smith/runs/2026-05-23T21-28-45-583Z.trace`.
- The retained workspace had no source diff and only `?? SMITH.TASK.md`; the note did not trigger.
- The code and test for this note were reverted and are not retained.
- Prompt integrity check: current `SWE_BENCH_PRO_TASK_INSTRUCTIONS` is empty, and benchmark tests assert SWE-bench Pro prompts are not wrapped with benchmark coaching.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Milestone: Memory-only Patches Do Not Reset Progress

Change:

- The generic stalled-progress counter now resets only after a successful task-file patch or finish.
- Successful patches that only touch root `SMITH.md` or `SMITH.TASK.md` no longer suppress the progress reminder.
- The reminder wording now says `task patch` to distinguish implementation/documentation changes from Smith memory maintenance.

Validation:

- `npm test -- tests/integration.test.ts`: passed `18` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `123598ms`, log `/tmp/smith/2026-05-23T21-51-32-915Z-smith-091-command-router-refactor.json`.

Target SWE evidence:

- Target SWE rerun `010-future-architect-vuls`: failed verifier in `811172ms`, log `/tmp/smith/2026-05-23T22-05-10-752Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-P7Cj9U/home/.smith/runs/2026-05-23T21-51-40-773Z.trace`.
- Usage: `1463993` total tokens.
- Retained workspace had a source diff in `scanner/alpine.go`, plus agent test edits and untracked `SMITH.md`.
- Official verifier failed with missing restored-test helper methods `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList`, plus `TestIsOvalDefAffected`.
- Trace search found generic progress reminders and no SWE-bench Pro benchmark wrapper or solving-coaching text.

Decision:

- Keep as a generic runtime improvement for long Smith tasks. It does not recover `010`, and no full SWE-bench Pro run is justified.
- Current valid score evidence remains `3/10`.

## 2026-05-23 Milestone: Generic Soft Run Deadline

Problem found:

- Clean `008-future-architect-vuls` under the current generic-only state timed out in `907187ms` with no workspace diff and no verifier.
- The trace showed progress reminders at 12, 24, and 36 tool calls, but the model still saw `turn 36 of 240` and had no wall-clock budget signal before Docker killed the run.

Change:

- Added `runtime.max_run_ms` and `--max-run-ms` as an optional soft wall-clock budget for ordinary Smith runs.
- Smith emits generic deadline reminders at 75% and 90% of `max_run_ms`; it does not add task-specific instructions or change command timeout semantics.
- Benchmark Smith runs now derive `--max-run-ms` as 80% of `--timeout-ms` unless the caller already supplied `--max-run-ms`, leaving time for verification and cleanup.
- Updated README, provider config docs, architecture docs, config tests, integration tests, and benchmark tests.

Validation:

- `npm test -- tests/config.test.ts tests/integration.test.ts tests/benchmark.test.ts`: passed `50` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `85116ms`, log `/tmp/smith/2026-05-23T22-30-12-052Z-smith-091-command-router-refactor.json`.

Target SWE evidence:

- Target SWE rerun `008-future-architect-vuls`: passed in `736190ms`, log `/tmp/smith/2026-05-23T22-42-35-317Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-nnfQET/home/.smith/runs/2026-05-23T22-30-20-373Z.trace`.
- External verifier ran selected `TestParse` and reported `{"passed": 1}`.
- Trace showed the generic deadline reminder at 75% (`elapsed 9m 17s of 12m max run time`) and no SWE-bench Pro prompt wrapper or solving-coaching text.

Decision:

- Count `008` as recovered under generic-only changes.
- Current strict valid evidence is baseline full-run passes `002`, `004`, `007` plus generic raw-prompt recovery `008`, for `4/10` targeted evidence. The earlier `003` pass needs raw-prompt revalidation before counting and is not a priority because Codex `gpt-5.4` high failed it.
- Still no full SWE-bench Pro run: current evidence is not yet plausibly `>=7/10`.

## 2026-05-23 Follow-up: 005 Reaches Verifier But Still Fails

Evidence:

- Target SWE rerun `005-gravitational-teleport` after the soft-deadline change failed verifier in `926948ms`, log `/tmp/smith/2026-05-23T23-00-30-497Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-pYnTrD/home/.smith/runs/2026-05-23T22-45-14-384Z.trace`.
- Unlike earlier `005` no-diff timeouts, Smith reached `finish` and the official verifier.
- Retained workspace source diff: `lib/kube/proxy/forwarder.go`, `lib/kube/proxy/server.go`, and `lib/service/kubernetes.go`.
- Verifier failed because `lib/kube/proxy/forwarder_test.go` still expects `Forwarder.cfg` and `Forwarder.clientCredentials`; the candidate removed/renamed those fields.
- Trace showed generic 75% and 90% deadline reminders and no SWE-bench Pro prompt wrapper or solving-coaching text.

Decision:

- Do not count `005` as recovered.
- The soft deadline is still retained because it moved `005` from repeated timeout/no-diff failures to a source patch, finish, and official verifier evidence.
- Current strict valid evidence remains `4/10`.

## 2026-05-23 Follow-up: 001 Still Times Out

Evidence:

- Target SWE rerun `001-nodebb-nodebb-vnan` after the soft-deadline change failed by Docker timeout in `919847ms`, log `/tmp/smith/2026-05-23T23-17-22-127Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-vtmiCD/home/.smith/runs/2026-05-23T23-02-16-898Z.trace`.
- Retained workspace had source diffs in `src/user/email.js`, `src/controllers/admin/users.js`, `src/database/redis/main.js`, and `src/socket.io/admin/user.js`.
- Trace showed generic 75% and 90% deadline reminders and no SWE-bench Pro prompt wrapper or solving-coaching text.
- Smith did not call `finish`; no verifier ran.

Decision:

- Do not count `001` as recovered.
- Current strict valid evidence remains `4/10`.

## 2026-05-24 Milestone: Single Timeout Tool Feedback

Change:

- Generic Smith loop cleanup: timed-out shell commands now replay one compact timeout result to the model instead of first replaying partial terminal output and then adding a second timeout observation.
- This is not SWE-bench-specific and does not add task-solving instructions.

Validation:

- `npm test -- tests/danger-review.test.ts tests/integration.test.ts`: passed `28` tests.
- `npm run build`: passed.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `137393ms`, log `/tmp/smith/2026-05-23T23-24-55-729Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `001-nodebb-nodebb-vnan`: failed by Docker timeout in `912045ms`, log `/tmp/smith/2026-05-23T23-40-14-094Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-OaTvIC/home/.smith/runs/2026-05-23T23-25-08-809Z.trace`.

Decision:

- Keep as a generic transcript-quality improvement.
- Do not count `001` as recovered; current strict valid evidence remains `4/10`.

## 2026-05-24 Diagnostic: 010 Still Fails Verifier

Evidence:

- Target SWE rerun `010-future-architect-vuls` reached `finish` and the official verifier under the raw prompt path, but failed in `734986ms`, log `/tmp/smith/2026-05-23T23-54-52-987Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-H07Va2/home/.smith/runs/2026-05-23T23-42-41-519Z.trace`.
- Retained source diff was `scanner/alpine.go` only after verifier setup restored edited test files.
- Verifier failure remained missing restored test-facing methods `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList`, plus `TestIsOvalDefAffected`.

Decision:

- Do not count `010` as recovered.
- Do not add prompt or runtime guidance about this task shape; current strict valid evidence remains `4/10`.

## 2026-05-24 Rejected: Generic Test-File Patch Note

Evidence:

- Trialed a generic patch-result note when Smith edits test-like files. It did not mention SWE-bench, selected tests, or verifier behavior.
- Focused tests/build passed and project benchmark `091-command-router-refactor` passed in `119331ms`, log `/tmp/smith/2026-05-23T23-59-43-122Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `010-future-architect-vuls` still failed official verifier in `783980ms`, log `/tmp/smith/2026-05-24T00-12-53-662Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-6CW0lO/home/.smith/runs/2026-05-23T23-59-50-545Z.trace`.
- Trace confirmed the note appeared repeatedly after edits to `scanner/alpine_test.go`, but Smith still finished after validating against edited tests; restored verifier tests failed with the same missing-method and `TestIsOvalDefAffected` failures.

Decision:

- Rejected and reverted the note to avoid accumulating prompt-like guidance without target improvement.
- Do not count `010` as recovered; current strict valid evidence remains `4/10`.

## 2026-05-24 Rejected/Inconclusive: Node+Go Image Experiment

Evidence:

- Built a disposable generic `smith-node-go:22-bookworm` image to test whether a fallback Node image with Go tooling could help Go tasks without changing prompts or scoring.
- Target `005-gravitational-teleport` with `--image smith-node-go:22-bookworm` failed before Smith started: workspace copy hit `no space left on device` in `2720ms`, log `/tmp/smith/2026-05-24T00-16-15-706Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`.
- Cleaned up the disposable image, failed sandbox `.smith-bench/run-7Sqhqv`, stopped containers, and unused Docker volumes.

Decision:

- Inconclusive and not retained as a Smith change.
- Current strict valid evidence remains `4/10`.

## 2026-05-24 Diagnostic: 003 Passes Under Raw Prompt

Evidence:

- Target SWE rerun `003-ansible` passed under the raw prompt path in `743891ms`, log `/tmp/smith/2026-05-24T00-32-57-133Z-smith-003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5.json`, trace `.smith-bench/run-26463c/home/.smith/runs/2026-05-24T00-20-38-192Z.trace`.
- Official verifier passed all required tests and reported `{"passed": 175}`.
- Prompt-integrity search found no SWE-bench prompt wrapper, `/task/verify.sh` coaching, exposed instance/base commit prompt text, or anti-history prompt text.

Decision:

- Count `003` as strict targeted evidence, but avoid overfocusing Codex-failed tasks per user guidance.
- Current strict valid evidence is now `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Diagnostic: 006 Fails Under Raw Prompt

Evidence:

- Target SWE rerun `006-navidrome` failed under the raw prompt path in `216805ms`, log `/tmp/smith/2026-05-24T00-38-43-189Z-smith-006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e.json`, trace `.smith-bench/run-yvl3l2/home/.smith/runs/2026-05-24T00-35-30-794Z.trace`.
- Official verifier failed on `TestLastFM` with build error `client.GetToken undefined`; `TestListenBrainz` and `TestSpotify` passed.
- Prompt-integrity search found no SWE-bench prompt wrapper, `/task/verify.sh` coaching, exposed instance/base commit prompt text, or anti-history prompt text.

Decision:

- Do not count the older prompt-coached `006` pass.
- Do not prioritize `006` further for now because Codex `gpt-5.4` high also failed it and the user asked not to overfocus flawed/Codex-failed tasks.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Milestone: PTY-Free Shell Fallback And Host Node Mount

Change:

- Generic Smith runtime improvement: `node-pty` now loads lazily, and Smith falls back to a plain non-PTY shell runner when the native PTY module is unavailable or `SMITH_FORCE_BASIC_SHELL=1`.
- Generic benchmark environment improvement: when the host Node runtime comes from a managed user install such as nvm, SWE-bench Pro edit containers can mount it read-only and probe the task image before falling back to `node:22-bookworm`.
- This preserves project toolchains in task images when possible without adding task or benchmark-solving instructions.

Validation:

- `npm test -- tests/pty.test.ts tests/benchmark.test.ts`: passed `23` tests.
- `npm run build`: passed.
- Docker smoke in the Teleport task image with mounted host Node: `node /smith/bin/smith.js --version` succeeded and `go version` reported `go1.16.15`.
- Project benchmark `benchmarks/091-command-router-refactor`: passed in `89905ms`, log `/tmp/smith/2026-05-24T00-49-52-438Z-smith-091-command-router-refactor.json`.
- Target SWE rerun `005-gravitational-teleport`: failed in `737993ms`, log `/tmp/smith/2026-05-24T01-02-21-459Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-pE8Wo8/home/.smith/runs/2026-05-24T00-50-11-318Z.trace`.
- The `005` log command shows Smith used the Teleport task image rather than a Node fallback image, and the official verifier ran in the task image.

Decision:

- Keep the change as a generic environment robustness improvement.
- Do not count `005` as recovered; Smith blocked after a patch context mismatch and left no source patch.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Diagnostic: 010 Still Fails After Environment Milestone

Evidence:

- Target SWE rerun `010-future-architect-vuls` failed in `953786ms`, log `/tmp/smith/2026-05-24T01-21-26-680Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-RddQvG/home/.smith/runs/2026-05-24T01-05-33-710Z.trace`.
- Prompt-integrity search found no SWE-bench prompt wrapper, `/task/verify.sh` coaching, exposed instance/base commit prompt text, or anti-history prompt text.
- Official verifier failed with missing restored test-facing methods `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList`, plus `TestIsOvalDefAffected`.

Decision:

- Do not count `010` as recovered.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Generic Patch Failure Feedback

Change:

- `smith_patch` failures now explicitly report that no files were changed because Smith patches are atomic, and suggest splitting independent edits into smaller patch calls.
- This is generic patch-tool recovery feedback, not SWE-bench-specific prompting.

Validation:

- `npm test -- tests/patch.test.ts`: passed `7` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `237311ms`, log `/tmp/smith/2026-05-24T01-32-00-145Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-SSuOzi/home/.smith/runs/2026-05-24T01-28-03-298Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed in `693235ms`, log `/tmp/smith/2026-05-24T01-43-45-572Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-jvD8mJ/home/.smith/runs/2026-05-24T01-32-19-475Z.trace`.

Evidence:

- The 005 run reached `finish` and the official verifier, but still failed with restored tests expecting `Forwarder.cfg` and `Forwarder.clientCredentials`.
- The new atomic patch failure message did not appear in this target trace, so there is no direct 005 recovery evidence from the change.

Decision:

- Keep as a small generic tooling improvement validated by unit/build/project checks.
- Do not count `005` as recovered.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Generic Multi-Document Patch Parsing

Change:

- `smith_patch` now accepts multiple complete `*** Begin Patch` / `*** End Patch` documents in one patch tool call and applies them atomically.
- This fixes a generic parser bug where Smith silently ignored patch documents after the first `*** End Patch`.

Validation:

- `npm test -- tests/patch.test.ts`: passed `9` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `210972ms`, log `/tmp/smith/2026-05-24T02-08-04-496Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-NWKpxR/home/.smith/runs/2026-05-24T02-04-33-758Z.trace`.
- Target SWE rerun `001-nodebb-nodebb-vnan`: failed by Docker timeout in `913657ms`, log `/tmp/smith/2026-05-24T02-23-27-535Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-9Yy6T7/home/.smith/runs/2026-05-24T02-08-22-307Z.trace`.

Evidence:

- The prior 001 trace showed a patch argument containing multiple complete patch documents, but only the first document applied.
- After the fix, the first 001 patch applied `9` files in one call: `src/user/email.js`, `src/socket.io/admin/user.js`, `src/controllers/admin/users.js`, `src/user/delete.js`, all three database adapters, the admin template, and the admin client script.
- 001 still did not reach `finish`; first source patch happened after the 90% deadline reminder and the outer Docker timeout killed the run.

Decision:

- Keep as a generic patch-tool correctness improvement.
- Do not count `001` as recovered.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Policy Clarification And Rejected Timing Experiment

Policy update:

- User clarified that prompt edits or runtime instructions specifically aimed at SWE-bench are cheating.
- SWE-bench task prompts must remain raw task text with no benchmark-specific coaching.
- `SWE_BENCH_PRO_TASK_INSTRUCTIONS` remains empty.
- Future improvements must be generic Smith behavior applicable to ordinary user tasks.

Rejected experiment:

- Tested an earlier generic benchmark `--max-run-ms` reservation (`65%` of outer timeout instead of `80%`) after 001 repeatedly failed to finish before Docker timeout.
- Focused tests and build passed before the target rerun:
  - `npm test -- tests/benchmark.test.ts`: passed `21` tests.
  - `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `165981ms`, log `/tmp/smith/2026-05-24T02-30-36-954Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-vgtn7D/home/.smith/runs/2026-05-24T02-27-51-192Z.trace`.
- Target SWE rerun `001-nodebb-nodebb-vnan`: failed by Docker timeout in `911156ms`, log `/tmp/smith/2026-05-24T02-45-57-978Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-dxWRjs/home/.smith/runs/2026-05-24T02-30-52-706Z.trace`.

Decision:

- Reverted the timing-ratio change; no Smith code change was retained.
- The trace showed the earlier deadline warnings fired, but the parent still did not reach `finish` or verifier.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Generic Text-Only Response Progress Accounting

Change:

- Smith now counts model responses that do not call any Smith tool toward the same progress and deadline reminder path used for ordinary tool calls.
- The reminder logic is shared for tool-call and no-tool-call turns.
- This is generic loop correctness for ordinary Smith runs; it does not add SWE-bench prompt or runtime instructions.

Validation:

- `npm test -- tests/danger-review.test.ts`: passed `10` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `231972ms`, log `/tmp/smith/2026-05-24T03-13-53-030Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-tq9AW0/home/.smith/runs/2026-05-24T03-10-01-283Z.trace`.
- Target SWE rerun `001-nodebb-nodebb-vnan`: failed by Docker timeout in `911129ms`, log `/tmp/smith/2026-05-24T03-08-42-902Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-CJrVH2/home/.smith/runs/2026-05-24T02-53-37-649Z.trace`.

Decision:

- Keep as a small generic robustness fix.
- The `001` trace had no `Model response did not call a Smith tool` entries, so the SWE evidence is neutral and does not count as recovery.
- Current strict valid evidence remains `5/10`: `002`, `003`, `004`, `007`, and `008`.

## 2026-05-24 Generic Patch History Compaction Recovers 001

Change:

- ChatGPT Codex native Responses history now compacts preserved historical `patch` function-call arguments.
- The current executable tool call still contains the full patch; only future replay of completed patch calls replaces the patch body with a Smith omission marker.
- This is a generic provider-history privacy and context-size fix, not a SWE-bench prompt or runtime instruction.

Validation:

- `npm test -- tests/providers.test.ts`: passed `15` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `58441ms`, log `/tmp/smith/2026-05-24T03-21-49-849Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-lvmgNC/home/.smith/runs/2026-05-24T03-20-51-646Z.trace`.
- Target SWE rerun `001-nodebb-nodebb-vnan`: passed in `730150ms`, log `/tmp/smith/2026-05-24T03-34-11-744Z-smith-001-nodebb-nodebb-vnan.json`, trace `.smith-bench/run-wP7m0X/home/.smith/runs/2026-05-24T03-22-07-594Z.trace`.

Evidence:

- Provider debug showed `43` requests; the final request had `71` native input items and `248249` input JSON characters.
- `2` requests contained the `smith omitted previous patch body` marker, and `0` requests replayed `*** Begin Patch` in provider input history.
- The target reached `finish` and official verifier exit `0`.

Decision:

- Count `001` as recovered under the strict no-cheating rule.
- Current targeted strict evidence is now `6/10`: `001`, `002`, `003`, `004`, `007`, and `008`.
- Do not run the full suite yet; one more Codex-passed Smith failure still needs recovery evidence before a full run is plausible.

## 2026-05-24 Generic Sub-Agent Turn-Limit Throttling

Change:

- If a `sub_agent` child run exhausts its turn budget without calling `finish`, Smith now hides `sub_agent` from the parent until a real task patch succeeds.
- This is generic Smith tool policy for ordinary tasks; it is not a SWE-bench prompt or benchmark-specific runtime instruction.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `20` tests.
- Project benchmark `091-command-router-refactor`: passed in `184430ms`, log `/tmp/smith/2026-05-24T04-00-15-610Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-5QZyia/home/.smith/runs/2026-05-24T03-57-11-411Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed in `753994ms`, log `/tmp/smith/2026-05-24T04-12-56-327Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-mA6ntS/home/.smith/runs/2026-05-24T04-00-29-969Z.trace`.

Evidence:

- Compared with the previous `005` run, the task no longer ended by Docker timeout. Smith reached `finish`, then the official verifier ran.
- The verifier failed with build errors in `lib/kube/proxy/forwarder.go` and restored-test failures; key errors included `f.AccessPoint undefined`, `s.parent.Client undefined`, and test references to removed `cfg` and `clientCredentials` fields.
- Trace evidence contains the new sub-agent-disabled reason and repeated child turn-limit failures, so the generic policy was exercised.

Decision:

- Keep the generic sub-agent throttling change because it helped Smith reach a verifier instead of timing out, but do not count `005` as recovered.
- Current targeted strict evidence remains `6/10`: `001`, `002`, `003`, `004`, `007`, and `008`.
- Still do not run the full suite; target `010` or another generic issue from `005` next.

## 2026-05-24 Diagnostic 010 Under Current Generic Build

Result:

- Target SWE rerun `010-future-architect-vuls`: failed in `838788ms`, log `/tmp/smith/2026-05-24T04-29-17-230Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-gXByii/home/.smith/runs/2026-05-24T04-15-19-360Z.trace`.
- Smith reached `finish` after `49` turns and the official verifier ran.
- Retained final diff changed only `scanner/alpine.go`.

Evidence:

- Verifier failed because selected Alpine parser tests could not find expected methods: `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList`.
- `TestIsOvalDefAffected` also failed: expected `affected: false` but got `true`, and expected empty `fixedIn` but got `3.3.2-r0`.

Decision:

- Do not count `010` as recovered.
- Current targeted strict evidence remains `6/10`.
- This does not justify a benchmark-specific prompt edit; any next change must be a generic Smith behavior improvement.

## 2026-05-24 Harness Integrity: Protect Restored SWE Test Files

Change:

- SWE-bench Pro runner now makes verifier-restored test files read-only during the editing agent run, then restores their original modes before verifier setup.
- This enforces benchmark integrity without exposing test contents or altering verifier scoring.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed `22` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `106363ms`, log `/tmp/smith/2026-05-24T04-35-35-202Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-cLnKfa/home/.smith/runs/2026-05-24T04-33-49-072Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed in `964190ms`, log `/tmp/smith/2026-05-24T04-51-50-320Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-B2kCyk/home/.smith/runs/2026-05-24T04-35-46-825Z.trace`.

Evidence:

- Trace contained `12` `EACCES` patch failures for `/workspace/scanner/alpine_test.go`, showing the selected test protection was exercised.
- Retained final diff changed only `scanner/alpine.go`.
- Verifier still failed with missing expected Alpine parser methods and `TestIsOvalDefAffected`.

Decision:

- Keep the change as anti-cheating harness integrity.
- Do not count `010` as recovered; strict targeted evidence remains `6/10`.
- Do not run the full suite yet.

## 2026-05-24 Generic Patch Permission Feedback

Change:

- Patch failures caused by permission errors now add a generic note that the target path is not writable and retrying the same patch will not help unless permissions change.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `21` tests.
- Project benchmark `091-command-router-refactor`: passed in `131148ms`, log `/tmp/smith/2026-05-24T04-57-06-568Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-GwyyiR/home/.smith/runs/2026-05-24T04-54-55-679Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed in `678614ms`, log `/tmp/smith/2026-05-24T05-08-31-866Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-3HxzDt/home/.smith/runs/2026-05-24T04-57-13-975Z.trace`.

Decision:

- Keep the generic patch feedback because it is ordinary tool-result clarity and reduced the `010` run duration/token usage.
- Do not count `010` as recovered; strict targeted evidence remains `6/10`.
- Avoid more `010`-specific iteration unless a new generic issue appears.

## 2026-05-24 Diagnostic 005 Under Current Generic Build

Result:

- Target SWE rerun `005-gravitational-teleport`: failed by Docker timeout in `910633ms`, log `/tmp/smith/2026-05-24T05-25-29-121Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-A0ww1p/home/.smith/runs/2026-05-24T05-10-23-878Z.trace`.
- Retained diff changed only `lib/kube/proxy/forwarder.go`.
- No verifier ran.

Decision:

- Do not count `005` as recovered.
- Current strict targeted evidence remains `6/10`.
- Full suite is still not justified.

## 2026-05-24 Generic Repeated Sub-Agent Failure Limit

Change:

- After one child run exhausts its turn budget, `sub_agent` remains hidden until a real task patch.
- After two child turn-limit failures in one parent run, `sub_agent` is hidden for the rest of that run.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `22` tests.
- Project benchmark `091-command-router-refactor`: passed in `90908ms`, log `/tmp/smith/2026-05-24T05-29-18-426Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-GhpsuT/home/.smith/runs/2026-05-24T05-27-47-745Z.trace`.

Target evidence:

- Target SWE rerun `005-gravitational-teleport` failed before producing Smith output: log `/tmp/smith/2026-05-24T05-42-58-986Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`.
- Error: `/home/smith/benchmark-results/smith.status` and `smith.stdout` were missing.
- The result recorded `sandboxRetained: true`, but `.smith-bench/run-wBbMN4` was not present afterward, so this target result is invalid for scoring comparison.

Decision:

- Keep the change as generic loop control, but do not count any SWE recovery.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.

## 2026-05-24 Generic Benchmark Result Artifact Isolation

Change:

- Benchmark Smith runs now write `smith.stdout`, `smith.stderr`, and status files to a separate mounted `/benchmark-results` directory instead of under the writable Smith home directory.
- The wrapper recreates the result directory after Smith/verifier commands and creates empty stdout/stderr files if the inner run removed them, so wrapper status capture and log replay do not fail because artifacts disappeared.
- Local benchmark and SWE-bench Pro Smith runs share this generic artifact path; verifier results continue to use the same mounted result directory.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed `22` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: passed in `124093ms`, log `/tmp/smith/2026-05-24T05-54-05-068Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-pbqKTb/home/.smith/runs/2026-05-24T05-52-01-214Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed functionally in `769019ms`, but produced valid Smith output, trace, sandbox, usage, and verifier evidence. Log `/tmp/smith/2026-05-24T06-07-02-365Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-BfvvUW/home/.smith/runs/2026-05-24T05-54-19-958Z.trace`.

Evidence:

- The previous invalid `005` rerun failed because `/home/smith/benchmark-results/smith.status` and `smith.stdout` were missing.
- The new `005` rerun retained `.smith-bench/run-BfvvUW/benchmark-results` with `smith.status`, `smith.stdout`, `smith.stderr`, verifier stdout/stderr logs, and parser output.
- Verifier failed because the candidate patch removed/renamed fields still referenced by `lib/kube/proxy/forwarder_test.go`; this is a task solution failure, not a harness artifact-loss failure.

Decision:

- Keep the change as generic benchmark harness reliability.
- Do not count `005` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.

## 2026-05-24 Generic Sustained-Inspection Throttle

Change:

- After `24` consecutive tool results without a task patch or finish on an editable run, Smith temporarily removes `run` and `sub_agent` from the available tool set until the agent patches or finishes.
- The throttle is generic loop control for long coding tasks that are stuck inspecting; it is not tied to SWE-bench Pro task names, repositories, tests, languages, or verifier behavior.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `23` tests.
- Project benchmark `091-command-router-refactor`: passed in `179597ms`, log `/tmp/smith/2026-05-24T06-18-40-848Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-vVGkBl/home/.smith/runs/2026-05-24T06-15-42-993Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed in `680894ms`, log `/tmp/smith/2026-05-24T06-30-10-954Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-n72o4K/home/.smith/runs/2026-05-24T06-18-58-088Z.trace`.

Evidence:

- Trace showed the throttle firing at `24` no-patch tool calls with available tools reduced to `patch, finish`; the agent patched immediately afterward.
- Compared with the previous valid `005` run, duration improved from `769019ms` to `680894ms`, turns from `51` to `34`, and total tokens from `1772196` to `1421728`.
- Verifier still failed because the candidate patch left `lib/kube/proxy` build errors around removed/renamed `Forwarder` fields.

Decision:

- Keep the change as generic anti-stall loop control.
- Do not count `005` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.

## 2026-05-24 Restored-Test Read-Only Mounts

Problem found:

- Target `010-future-architect-vuls` exposed a harness-integrity gap rather than a Smith capability improvement opportunity.
- Trace `.smith-bench/run-qPXnu8/home/.smith/runs/2026-05-24T06-31-54-205Z.trace` showed Smith first hit `EACCES` editing `scanner/alpine_test.go`, then ran `chmod u+w scanner/alpine_test.go`, rewrote the selected test file, and only later had the benchmark verifier restore tests.
- Relying only on file mode bits was insufficient because the editing container could change permissions.

Change:

- SWE-bench Pro restored test files are now also bind-mounted back into the Smith editing container as read-only files at their workspace paths.
- The restored-test tracking records both host path and workspace-relative path so Docker can mount each protected file as `/workspace/<relativePath>:ro`.
- This is harness integrity, not prompt coaching: it prevents edits to verifier-restored files instead of telling the model benchmark-specific behavior.

Validation:

- `npm test -- tests/benchmark.test.ts`: passed `22` tests.
- `npm run build`: passed.
- Project benchmark `091-command-router-refactor`: first rerun failed by model variance before `finish`; retry passed in `199220ms`, log `/tmp/smith/2026-05-24T06-57-32-330Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-oOe9dN/home/.smith/runs/2026-05-24T06-54-13-508Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed by Docker timeout in `906118ms`, log `/tmp/smith/2026-05-24T07-12-46-341Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-59Lpvq/home/.smith/runs/2026-05-24T06-57-40-975Z.trace`.

Evidence:

- The new `010` trace showed attempted test overwrite failing with `bash: scanner/alpine_test.go: Read-only file system`.
- A follow-up `chmod u+w scanner/alpine_test.go` failed with `Read-only file system`.
- A remove-and-replace attempt failed with `Device or resource busy`.
- The retained workspace only had `scanner/alpine.go` modified, so the protected restored test file was not changed.

Decision:

- Keep the read-only bind mounts as generic benchmark harness integrity.
- Do not count `010` as recovered; the run timed out before `finish` or verifier.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.

## Operational Note: `.smith-bench` Cleanup

- Retained sandboxes are useful for trace and verifier evidence, but `.smith-bench` grows quickly. On 2026-05-24 it was `4.5G` across `8` retained `run-*` directories.
- Periodically check `du -sh .smith-bench` and remove old `.smith-bench/run-*` directories after their logs/traces have been recorded or they are no longer needed for diagnosis.
- Do not delete active runs or evidence referenced by the current investigation until the relevant notes are committed.

## 2026-05-24 Generic Max-Run Finalization Gate

Change:

- When `runtime.max_run_ms` elapses, Smith now hides `run` and `sub_agent` for the rest of the run, leaving `patch` and `finish` available.
- The deadline state persists across later task patches, so a late edit does not reopen inspection tools after the configured budget has expired.
- This is generic loop control for ordinary long-running Smith tasks and benchmark runs; it does not mention SWE-bench Pro, task names, languages, repositories, tests, or verifier details.
- README and benchmark docs now describe `max_run_ms` as a deadline with finalization behavior, not only a reminder.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `24` tests.
- Project benchmark `091-command-router-refactor`: passed in `185032ms`, log `/tmp/smith/2026-05-24T07-20-35-256Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-W3UN8Z/home/.smith/runs/2026-05-24T07-17-30-658Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after reaching verifier in `776252ms`, log `/tmp/smith/2026-05-24T07-33-37-960Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-njnqjz/home/.smith/runs/2026-05-24T07-20-42-496Z.trace`.

Evidence:

- Integration test coverage proves that after `max_run_ms` elapses, the next provider request exposes only `patch` and `finish`, and a attempted `run` call is rejected as unavailable.
- The `010` target run did not directly exercise the finalization gate: it finished after the 90% reminder and before the 12-minute `max_run_ms` elapsed.
- The target still reached the official verifier instead of Docker timeout, but verifier failed because restored tests expected `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList`, and `TestIsOvalDefAffected` still failed.

Decision:

- Keep the finalization gate as generic deadline control.
- Do not count `010` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: after this run `.smith-bench` was `7.3G` with `10` retained `run-*` directories.

## 2026-05-24 Salient Failed Command Output

Change:

- Smith now prefixes nonzero terminal-command results with `Command failed with exit status N.` before replaying output to the model.
- The existing `exit_status: N` footer remains in place for all commands.
- This is a generic result-clarity improvement for ordinary user tasks and benchmark runs; it does not change prompts, task selection, verifier behavior, scoring, result parsing, or task-specific logic.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `25` tests.
- Project benchmark `091-command-router-refactor`: passed in `240621ms`, log `/tmp/smith/2026-05-24T07-43-58-077Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-WcT5o3/home/.smith/runs/2026-05-24T07-39-57-704Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `926531ms`, log `/tmp/smith/2026-05-24T07-59-34-096Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-AcVYwy/home/.smith/runs/2026-05-24T07-44-08-336Z.trace`.

Evidence:

- The `010` trace replayed a failed `go test ./scanner ./oval ./models` command with the new salient header before the long compiler output.
- The model no longer claimed broad validation had passed; the final response said the full test suite could not be rerun after the last fix and verification was pending.
- The verifier still failed on the selected Alpine parser tests and `TestIsOvalDefAffected`, so this is an evidence-quality improvement, not a recovery.

Decision:

- Keep the failed-command header as generic command-result clarity.
- Do not count `010` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `8.7G` with `12` retained `run-*` directories. Periodically prune old retained runs after their log paths, trace paths, and needed evidence have been recorded and committed.

## 2026-05-24 Post-Deadline Validation Run

Change:

- After `runtime.max_run_ms` elapses, Smith still hides inspection and delegation tools by default.
- If a task patch succeeds after that deadline, Smith now allows exactly one bounded `run` call for validation, then hides `run` again.
- Post-deadline inspection commands such as `sed`, `cat`, `rg`, `grep`, `find`, and `ls` are rejected without consuming the one validation opportunity.
- This is generic deadline behavior for ordinary Smith coding tasks; it is not tied to SWE-bench Pro, task names, languages, repositories, selected tests, or verifier parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `26` tests.
- Project benchmark `091-command-router-refactor`: passed in `119530ms`, log `/tmp/smith/2026-05-24T08-28-27-045Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-BKzXXO/home/.smith/runs/2026-05-24T08-26-28-125Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `863380ms`, log `/tmp/smith/2026-05-24T08-43-00-717Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-idyExh/home/.smith/runs/2026-05-24T08-28-38-243Z.trace`.

Evidence:

- A preliminary `010` rerun with the one-shot post-deadline run available showed the model using that run for `sed` inspection, not validation. That prompted the generic inspection-command rejection above.
- The final `010` rerun did not exercise the post-deadline validation allowance because no successful task patch happened after finalization. It still reached verifier, which failed with `scanner/alpine.go:212:9: declared and not used: version`, the same missing selected Alpine parser tests, and `TestIsOvalDefAffected`.

Decision:

- Keep the generic validation-only post-deadline run because focused tests cover the intended behavior and the local project benchmark passed.
- Do not count `010` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `10G` with `16` retained `run-*` directories. Prune old retained runs after their log paths, trace paths, and relevant evidence are recorded and committed.

## 2026-05-24 Unvalidated Patch Deadline Validation

Change:

- If an actual task patch is still unvalidated when `runtime.max_run_ms` elapses, Smith now opens the same one bounded validation `run` slot before finalization.
- The existing post-deadline validation slot still applies when a patch happens after finalization.
- Simple inspection commands remain rejected in that slot without consuming the validation opportunity.
- This is generic runtime behavior for ordinary coding tasks that patch near a wall-clock budget; it does not change prompts, selected tests, verifier logic, scoring, result parsing, or task-specific logic.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `27` tests.
- Project benchmark `091-command-router-refactor`: passed in `143773ms`, log `/tmp/smith/2026-05-24T08-49-56-066Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-w7umNf/home/.smith/runs/2026-05-24T08-47-32-750Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `902379ms`, log `/tmp/smith/2026-05-24T09-05-14-043Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-Rb748m/home/.smith/runs/2026-05-24T08-50-12-441Z.trace`.

Evidence:

- The `010` trace showed the new unvalidated-patch validation slot running `go test ./scanner -run 'TestParseApkInfo|TestParseApkVersion'`.
- That command failed with a compile mismatch before finish: `assignment mismatch: 2 variables but o.scanInstalledPackages returns 3 values` and `assignment mismatch: 2 variables but d.parseApkInfo returns 3 values`.
- Smith then attempted a simple inspection command in the post-deadline slot and Smith rejected it with the validation-only message, preserving the intended boundary.
- The final verifier still failed on missing selected Alpine parser tests and `TestIsOvalDefAffected`.

Decision:

- Keep the unvalidated-patch deadline validation slot because it surfaced a real compile failure before finalization and remains generic.
- Do not count `010` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `12G` with `18` retained `run-*` directories. Prune stale retained runs once their evidence is recorded and committed.

## 2026-05-24 Maintenance Note: Retained Sandboxes

- `.smith-bench` can grow by several GB during SWE-bench iteration because each `--keep-sandbox` run retains a full checkout, trace, and artifacts.
- Before long benchmark sessions, check `du -sh .smith-bench` and `find .smith-bench -maxdepth 1 -type d -name 'run-*' | wc -l`.
- Periodically remove stale retained runs only after the result JSON path, trace path, sandbox path, key evidence, and any useful diffs have been recorded in this summary/worklog and committed.
- Keep the newest active evidence sandboxes until the related diagnosis or milestone is closed.

## 2026-05-24 Benchmark Headroom

Change:

- Benchmark-derived Smith runs now use `--max-run-ms` at 65% of `--timeout-ms` instead of 80%.
- Benchmark-derived Smith runs also add a bounded `--provider-timeout-ms` unless the caller already supplied one.
- This is generic benchmark harness reliability: it applies across benchmark tasks and prevents late provider turns from consuming the entire wrapper timeout before result capture or verification.

Validation:

- `npm run build`: passed.
- `npm test -- tests/benchmark.test.ts`: passed `22` tests.
- Representative project task `091-command-router-refactor`: first run exposed the provider timeout gap and failed with `docker timed out after 300000ms`; after adding the derived provider timeout it passed in `155102ms`, log `/tmp/smith/2026-05-24T09-38-49-479Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-N8iscQ/home/.smith/runs/2026-05-24T09-36-15-546Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `648657ms`, log `/tmp/smith/2026-05-24T09-49-49-013Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-KUcK2S/home/.smith/runs/2026-05-24T09-39-06-777Z.trace`.

Decision:

- Keep the generic benchmark headroom change because it converted `005` from an outer Docker timeout into a verifier-backed failure and preserved the representative local benchmark pass.
- Do not count `005` as recovered: the verifier still failed on compile errors from an incomplete `Forwarder` refactor (`cfg` and `clientCredentials` fields missing).
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `15G` with `22` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Benchmark Headroom Retune

Change:

- Retuned benchmark-derived `--max-run-ms` from 65% to 75% of `--timeout-ms`.
- Raised the benchmark-derived provider request timeout cap from `90000ms` to `180000ms`.
- The provider timeout still derives from the benchmark timeout, keeps the 20% ratio and `30000ms` floor, and is skipped when the caller explicitly supplies `--provider-timeout-ms`.

Validation:

- `npm run build`: passed.
- `npm test -- tests/benchmark.test.ts`: passed `22` tests.
- Project benchmark `091-command-router-refactor`: passed twice after the ratio retune; latest passed in `184995ms`, log `/tmp/smith/2026-05-28T14-16-19-930Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-rDJwpQ/home/.smith/runs/2026-05-28T14-13-15-151Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `724213ms`, log `/tmp/smith/2026-05-28T14-28-31-124Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-T1tCnn/home/.smith/runs/2026-05-28T14-16-41-486Z.trace`.

Decision:

- Keep the retune because the `90000ms` provider cap caused an early provider-timeout failure on `005`, while `180000ms` restored verifier-backed evidence without breaking the representative local benchmark.
- Do not count `005` as recovered: verifier still fails on incomplete `Forwarder` changes (`cfg` and `clientCredentials` fields missing).
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `20G` with `28` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Patch Validation Feedback

Change:

- Successful non-memory task patches now return an immediate generic validation reminder in the patch tool output.
- Validation-like commands whose output says no tests ran no longer clear the pending-patch validation state or consume the one post-deadline validation run.
- This is generic runtime/tool feedback for ordinary coding tasks; it does not mention SWE-bench, task names, languages, selected tests, scoring, parsers, or verifier internals.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `28` tests after rebuilding. A first parallel build/test attempt failed because the CLI integration test used stale built output before `tsc` finished; rerunning after build passed.
- Project benchmark `091-command-router-refactor`: passed twice; latest passed in `168205ms`, log `/tmp/smith/2026-05-28T15-39-53-824Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-xPtIVT/home/.smith/runs/2026-05-28T15-37-05-848Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `878462ms`, log `/tmp/smith/2026-05-28T15-54-37-777Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-HPHEZB/home/.smith/runs/2026-05-28T15-40-02-260Z.trace`.

Evidence:

- Before the no-op validation fix, `005` ran `go test ./lib/kube/proxy ./lib/service -run TestDoesNotExist -count=0`, reported that no-op check as passing, and still failed the verifier with the same `Forwarder` compile errors.
- After the no-op validation fix, `005` ran a real `go test ./lib/kube/proxy -count=1`, found nil-pointer regressions in `setupContext`, `newClusterSessionSameCluster`, and `requestCertificate`, and reported the blocker more accurately.
- The verifier still failed on the same compile shape: `Forwarder` missing `cfg` and `clientCredentials`.

Decision:

- Keep the patch validation feedback change because it is generic, focused-test covered, local-benchmark validated, and improves validation quality.
- Do not count `005` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `24G` with `32` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Failed Validation Feedback

Change:

- Validation-like commands that fail now append a generic warning that any pending task patch is not validated as complete.
- Failed validation commands no longer clear the pending-patch validation state.
- This is generic runtime/tool feedback for ordinary coding tasks; it is not benchmark-, dataset-, task-, language-, parser-, or verifier-specific.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `29` tests.
- Project benchmark `091-command-router-refactor`: first run failed because Smith only ran `node test.js` and missed the README verification section; repeat run passed in `202558ms`, log `/tmp/smith/2026-05-28T16-06-47-365Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-TeiQII/home/.smith/runs/2026-05-28T16-03-25-025Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `799438ms`, log `/tmp/smith/2026-05-28T16-20-23-210Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-VzgCHb/home/.smith/runs/2026-05-28T16-07-04-581Z.trace`.

Decision:

- Keep the failed-validation feedback change because focused tests pass, the representative project task passed on repeat, and `010` trace evidence shows the warning attached to real failed `go test` output.
- Do not count `010` as recovered: verifier still failed on incomplete Alpine parser/test wiring and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `25G` with `35` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Sandbox Cleanup Reminder

- `.smith-bench` is now `26G` with `37` retained `run-*` directories.
- Keep enough retained sandboxes to preserve current failure evidence, but periodically prune stale runs after the relevant log paths, trace snippets, commands, and decisions have been recorded here and committed.
- This is an operational hygiene item only; do not remove retained evidence that is still needed to compare a current hypothesis or explain a committed benchmark decision.

## 2026-05-28 Read-only Finish Guard

Change:

- Added a generic finish guard that rejects unsupported read-only or permission-blocker final answers when the run is writable and `patch` is available.
- The guard only applies when the final answer claims an inability to edit due to read-only/permission state and the transcript lacks supporting tool evidence such as `EACCES`, `EROFS`, `EPERM`, `permission denied`, or `read-only file system`.
- This is a generic runtime consistency check; it does not mention SWE-bench, task IDs, task content, selected tests, scoring, parsers, or verifier logic.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `31` tests.
- Project benchmark `091-command-router-refactor`: passed in `101549ms`, log `/tmp/smith/2026-05-28T16-44-10-768Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-iOD4EG/home/.smith/runs/2026-05-28T16-42-29-566Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `798806ms`, log `/tmp/smith/2026-05-28T16-57-34-429Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-OOhC5N/home/.smith/runs/2026-05-28T16-44-16-511Z.trace`.

Decision:

- Keep the guard because focused tests cover unsupported and supported read-only finish claims, and the representative project task still passes.
- Do not count `010` as recovered: the latest trace had real `patch failed: EROFS: read-only file system` evidence for `scanner/alpine_test.go`, so the guard correctly allowed the blocker and the verifier still failed.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `27G` with `39` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Current 005 Rerun Evidence

- Reran `005-gravitational-teleport` on the current generic runtime after the failed-validation and read-only-finish guard milestones.
- Result: failed after verifier in `851410ms`, log `/tmp/smith/2026-05-28T17-13-32-408Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-HzICOJ/home/.smith/runs/2026-05-28T16-59-26-298Z.trace`.
- Smith reached `finish` with an explicit blocker instead of timing out, but the candidate patch still left incomplete `Forwarder` API/refactor errors such as `imported and not used: "os"`, `s.parent.Client undefined`, `cfg.Client undefined`, and restored-test references to missing `Forwarder` fields.
- Trace evidence showed the generic feedback worked as designed: patch validation reminders appeared, failed validation did not clear the patch state, and post-deadline inspection commands were rejected in the validation slot.
- Decision: do not count `005` as recovered. This is now mostly a patch-quality/refactor-completion failure, with a possible generic improvement area around repeated patch context failures and too-large partial refactors.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `29G` with `40` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Patch Context Guidance

Change:

- Added generic patch-tool guidance for `hunk context not found` failures: inspect the exact current lines before retrying, then send a smaller patch anchored to that output.
- This is generic tool feedback for ordinary patch mismatches; it does not mention SWE-bench, task IDs, selected tests, scoring, parsers, or verifier behavior.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `32` tests.
- Project benchmark `091-command-router-refactor`: passed in `148043ms`, log `/tmp/smith/2026-05-28T17-18-02-813Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-dAaP1s/home/.smith/runs/2026-05-28T17-15-35-031Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `633556ms`, log `/tmp/smith/2026-05-28T17-28-45-094Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-NUHtkf/home/.smith/runs/2026-05-28T17-18-28-135Z.trace`.

Decision:

- Keep the patch-context guidance because it is generic, focused-test covered, project-task validated, and the `005` trace shows the new guidance after hunk-context failures.
- Do not count `005` as recovered: the verifier still failed on restored-test-facing `Forwarder.cfg` and `Forwarder.clientCredentials` compatibility errors. The final Smith answer also overstated validation because local `go test ./lib/kube/proxy ./lib/service` passed before verifier restoration exposed the remaining incompatibility.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `31G` with `42` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Generic Refactor Compatibility Guidance

Change:

- Added one generic base-prompt instruction: when refactoring or renaming code, Smith should inspect existing call sites and preserve compatibility shims, aliases, wrappers, or config fields when practical unless the task explicitly asks for a breaking change.
- This intentionally does not mention SWE-bench, benchmarks, restored tests, task IDs, languages, file names, verifier behavior, or any task-specific identifiers.

Validation:

- `npm run build`: passed.
- `npm test -- tests/prompt-trace.test.ts`: passed `8` tests.
- Project benchmark `091-command-router-refactor`: passed in `158606ms`, log `/tmp/smith/2026-05-28T17-36-47-852Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-rLH5dK/home/.smith/runs/2026-05-28T17-34-09-478Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `705348ms`, log `/tmp/smith/2026-05-28T17-48-37-839Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-iDDpv2/home/.smith/runs/2026-05-28T17-36-55-696Z.trace`.

Decision:

- Keep the prompt change as a small generic agent-quality improvement because focused tests, build, and the representative project task passed.
- Do not count `005` as recovered. The model claimed it preserved compatibility, but the verifier still failed on missing `Forwarder.cfg` and `Forwarder.clientCredentials` fields after its local package validation passed.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `33G` with `44` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Read-only Patch Recovery Guidance

Change:

- Expanded generic patch permission guidance to recognize `EROFS`, `EPERM`, and `read-only file system` errors in addition to `EACCES` and `permission denied`.
- The guidance now tells Smith to patch other writable files when the task can still be solved there, instead of treating one unwritable path as the whole blocker.
- This is generic patch-tool feedback for ordinary read-only or permission-denied paths; it does not mention SWE-bench, benchmarks, restored tests, task IDs, languages, filenames, verifier behavior, or scoring.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `32` tests after rerunning against the rebuilt CLI.
- Project benchmark `091-command-router-refactor`: passed in `171916ms`, log `/tmp/smith/2026-05-28T17-54-22-633Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-dtkEHR/home/.smith/runs/2026-05-28T17-51-31-144Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `641103ms`, log `/tmp/smith/2026-05-28T18-05-09-368Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-OrJGnA/home/.smith/runs/2026-05-28T17-54-28-949Z.trace`.

Decision:

- Keep the generic permission guidance because focused tests, build, and the representative project task passed.
- Do not count `010` as recovered. This target run did not hit the new read-only guidance; it patched only `scanner/alpine.go`, then the verifier still failed on missing `parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`, and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `33G` with `46` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Validation Tool Availability Finish Guard

Change:

- Added a generic finish guard that rejects final answers claiming validation is impossible because `run` or validation commands are unavailable when the `run` tool is actually available.
- This is generic runtime consistency feedback; it does not mention SWE-bench, benchmarks, restored tests, task IDs, languages, filenames, verifier behavior, or scoring.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `33` tests.
- Project benchmark `091-command-router-refactor`: passed in `93817ms`, log `/tmp/smith/2026-05-28T18-30-39-223Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-FLduSe/home/.smith/runs/2026-05-28T18-29-05-741Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `803837ms`, log `/tmp/smith/2026-05-28T18-44-08-185Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-csY8iJ/home/.smith/runs/2026-05-28T18-30-45-184Z.trace`.

Decision:

- Keep the guard because focused tests, build, and the representative project task passed.
- Do not count `010` as recovered. The latest run did perform targeted scanner validation and reached verifier, but restored tests still failed on missing `parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`, and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `35G` with `50` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Narrow Validation Feedback

Change:

- Added generic runtime feedback for validation commands that select a subset of tests, such as `-run`, `--grep`, `-k`, or test-name/path filters.
- A passing selected-test command now warns that the patch is only narrowly validated and does not clear pending patch validation or consume the one post-deadline validation slot.
- This is generic tool-output behavior for ordinary coding tasks; it does not mention SWE-bench, task IDs, restored tests, scoring, parsers, verifier behavior, or any dataset-specific detail.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `34` tests.
- Project benchmark `091-command-router-refactor`: passed in `142445ms`, log `/tmp/smith/2026-05-28T19-08-14-842Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-cZ94tk/home/.smith/runs/2026-05-28T19-05-52-891Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `757793ms`, log `/tmp/smith/2026-05-28T19-20-56-956Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-183GvU/home/.smith/runs/2026-05-28T19-08-19-953Z.trace`.

Decision:

- Keep the change because focused tests and the representative project benchmark passed, and the target trace shows the no-op validation warning preserved the need for real validation.
- Do not count `010` as recovered. The verifier still failed on missing `parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`, and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `37G` with `54` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Locked Path Patch Guidance

Change:

- Extended generic patch failure guidance to treat `EBUSY` / `resource busy or locked` like other non-writable target path failures.
- Smith now gets the same "do not keep retrying this path; patch other writable files when possible" guidance for locked paths.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `34` tests.
- Project benchmark `091-command-router-refactor`: passed in `138203ms`, log `/tmp/smith/2026-05-28T19-26-05-555Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-qd4VQW/home/.smith/runs/2026-05-28T19-23-47-591Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `754463ms`, log `/tmp/smith/2026-05-28T19-38-46-072Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-GV6ruk/home/.smith/runs/2026-05-28T19-26-12-294Z.trace`.

Decision:

- Keep the change as generic no-regression patch-tool feedback. The latest target rerun did not hit `EBUSY`, but the immediately preceding `010` trace did.
- Do not count `010` as recovered. The verifier still failed on missing Alpine helper methods and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `39G` with `56` retained `run-*` directories. Prune stale retained runs after recorded evidence has been committed.

## 2026-05-28 Benchmark Smith Headroom Retune

Change:

- Retuned the generic benchmark runner Smith `--max-run-ms` default from `75%` to `85%` of the task `--timeout-ms`.
- Updated the benchmark documentation and focused test expectation for the new ratio.
- This is a generic harness headroom change. It does not alter task prompts, selected tests, verifiers, scoring, result parsing, or any SWE-bench-specific instruction.

Validation:

- `npm run build`: passed.
- `npm test -- tests/benchmark.test.ts`: passed `22` tests.
- Project benchmark `091-command-router-refactor`: passed in `191440ms`, log `/tmp/smith/2026-05-28T19-56-24-701Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-QGUX8L/home/.smith/runs/2026-05-28T19-53-13-756Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `805870ms`, log `/tmp/smith/2026-05-28T20-09-59-642Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-MabxUC/home/.smith/runs/2026-05-28T19-56-38-008Z.trace`.

Decision:

- Keep the retune for now because focused checks and the representative project benchmark passed, and the target run still left enough outer timeout for result capture and verifier execution.
- Do not count `005` as recovered. The verifier still failed on compatibility errors around `Forwarder.cfg` and `Forwarder.clientCredentials`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `42G` with `59` retained `run-*` directories. Periodically prune stale retained runs after the commands, logs, trace paths, and needed snippets are recorded, so this folder does not grow into several more GB unnecessarily.

## 2026-05-28 Pending Validation Finish Guard

Change:

- Added a generic finish guard for task patches that are still pending validation while `run` is available.
- If Smith tries to finish with an ordinary completion report before a real validation command clears the pending-patch state, the finish is rejected and Smith is told to run relevant validation or explicitly report a blocker/pending-validation state.
- Explicit pending-validation or blocker reports remain allowed.
- This is generic runtime behavior for ordinary coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `35` tests.
- Project benchmark `091-command-router-refactor`: passed in `202076ms`, log `/tmp/smith/2026-05-28T20-31-41-196Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-coHZ3z/home/.smith/runs/2026-05-28T20-28-19-360Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `878894ms`, log `/tmp/smith/2026-05-28T20-46-25-506Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-kdtU1W/home/.smith/runs/2026-05-28T20-31-47-404Z.trace`.

Decision:

- Keep the guard because it is generic, focused-test covered, build-clean, and the representative project task passed.
- Do not count `010` as recovered. The target rerun still failed on missing Alpine parser compatibility methods and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `45G` with `62` retained `run-*` directories. Prune stale retained runs after this milestone is committed and the useful trace/log paths are preserved.

## 2026-05-28 Current-State Diagnostic: 009 OpenLibrary

Evidence:

- Reran `009-internetarchive-openlibrary` once under the current generic runtime after exhausting the higher-priority Codex-passed failures `005` and `010`.
- Result: failed after verifier in `762254ms`, log `/tmp/smith/2026-05-28T21-00-58-295Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`, trace `.smith-bench/run-3SFFCD/home/.smith/runs/2026-05-28T20-48-18-069Z.trace`.
- Verifier ran `openlibrary/catalog/marc/tests/test_parse.py`: `57 passed`, `2 failed`.
- Failures: `TestParseMARCXML::test_xml[nybc200247]` with `AttributeError: 'lxml.etree._Element' object has no attribute 'get_subfield_values'`, and `TestParseMARCBinary::test_binary[880_arabic_french_many_linkages.mrc]` with one title value instead of two.

Decision:

- Do not count `009` as recovered.
- Do not tune specifically for `009`; Codex `gpt-5.4` high also failed it, and this diagnostic is only evidence that current generic runtime now reaches verifier rather than timing out.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `45G` with `63` retained `run-*` directories. Prune stale retained runs after this diagnostic is committed.

## 2026-05-28 Explicit Test-File Validation Warning

Change:

- Extended the generic narrow-validation detector to treat explicit test node selectors and concrete test-file paths as selected checks.
- Examples include `pytest tests/test_x.py::Test::case` and `npm test -- tests/foo.test.js`.
- These commands now warn that validation is narrow and do not clear pending patch validation.
- This is generic validation hygiene for ordinary coding tasks; it does not mention SWE-bench, task IDs, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `36` tests.
- Project benchmark `091-command-router-refactor`: passed in `153756ms`, log `/tmp/smith/2026-05-28T21-06-45-862Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-AEOEqb/home/.smith/runs/2026-05-28T21-04-12-609Z.trace`.
- Target SWE rerun `009-internetarchive-openlibrary`: failed after verifier in `707121ms`, log `/tmp/smith/2026-05-28T21-18-37-860Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`, trace `.smith-bench/run-pts0tb/home/.smith/runs/2026-05-28T21-06-51-722Z.trace`.

Decision:

- Keep the change because focused tests and the representative project task passed, and the target trace shows the warning/rejection path exercised.
- Do not count `009` as recovered. The target rerun still failed on two `test_parse.py` cases after broader local validation.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `45G` with `65` retained `run-*` directories. Prune stale retained runs after this milestone is committed and the useful trace/log paths are preserved.

## 2026-05-28 Track Run-Command Edits

Change:

- Smith now snapshots tracked Git changes around `run` tool calls.
- If a shell command changes tracked files, Smith reports the changed paths and treats the run as a pending task patch that still needs validation.
- This closes a generic loop bookkeeping gap where shell-based edits could bypass the pending-validation state used for `patch` edits.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `37` tests.
- Project benchmark `091-command-router-refactor`: passed in `135734ms`, log `/tmp/smith/2026-05-28T21-24-44-423Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-fNI9M2/home/.smith/runs/2026-05-28T21-22-28-915Z.trace`.
- Target SWE rerun `009-internetarchive-openlibrary`: failed after verifier in `654612ms`, log `/tmp/smith/2026-05-28T21-35-49-138Z-smith-009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59.json`, trace `.smith-bench/run-Pp8GO6/home/.smith/runs/2026-05-28T21-24-55-574Z.trace`.

Decision:

- Keep the change because it is generic bookkeeping, focused-test covered, and project validation passed.
- Do not count `009` as recovered. The target trace did not directly exercise the new run-edit message; it still failed on MARC parser verifier cases.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `46G` with `67` retained `run-*` directories. Prune stale retained runs after this milestone is committed and the useful trace/log paths are preserved.

## 2026-05-28 Keep Validation Slot After Failed Check

Change:

- Smith no longer consumes the single post-deadline validation run when the validation command itself fails.
- A failed validation still leaves the task patch pending and keeps one real validation opportunity available, so the agent can fix the failure and run a passing check before finish.
- This is generic runtime behavior for ordinary coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `38` tests.
- Project benchmark `091-command-router-refactor`: passed in `98191ms`, log `/tmp/smith/2026-05-28T21-58-05-131Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-xv76lu/home/.smith/runs/2026-05-28T21-56-27-169Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `739706ms`, log `/tmp/smith/2026-05-28T22-10-31-772Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-wyGo68/home/.smith/runs/2026-05-28T21-58-17-250Z.trace`.

Decision:

- Keep the change because it is generic validation bookkeeping, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. The target rerun still failed on restored-test-facing compatibility errors around `Forwarder.cfg` and `Forwarder.clientCredentials`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `49G` with `70` retained `run-*` directories. Periodically prune stale retained runs after useful log and trace evidence has been recorded so the folder does not grow unchecked by several more GB.

## 2026-05-28 Warn On Test-File Patches

Change:

- When a patch changes likely test files, Smith now reports the changed test paths and warns that local validation may include those changed tests.
- The warning asks Smith to preserve compatibility with existing test behavior when the user did not ask for test updates.
- This is generic runtime feedback for ordinary coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: first concurrent run failed because the CLI test raced with the build and used stale compiled output; rerun after build passed `39` tests.
- Project benchmark `091-command-router-refactor`: passed in `105835ms`, log `/tmp/smith/2026-05-28T22-15-14-374Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-zXur6y/home/.smith/runs/2026-05-28T22-13-28-763Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed in `909726ms`, log `/tmp/smith/2026-05-28T22-30-29-356Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-FzZMi1/home/.smith/runs/2026-05-28T22-15-20-394Z.trace`.

Decision:

- Keep the change because it is generic validation feedback, focused-test covered, build-clean, and project validation passed.
- Do not count `010` as recovered. The target trace did not directly exercise the new test-file warning on a successful test patch, and the verifier still failed on Alpine scanner/OVAL test cases.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `51G` with `72` retained `run-*` directories. Prune stale retained runs after useful log and trace evidence has been recorded.

## 2026-05-29 Unwritable Test Patch Guidance

Change:

- Extended generic non-writable patch guidance when the failed target path appears to be a test or spec file.
- Smith is now told that, if the user did not explicitly ask to update tests, the test should be treated as existing behavior to satisfy through source changes rather than as the blocker.
- This is generic patch-tool feedback for ordinary coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: first concurrent run failed because the CLI test raced with the build and used stale compiled output; rerun after build passed `40` tests.
- Project benchmark `091-command-router-refactor`: passed in `102555ms`, log `/tmp/smith/2026-05-28T22-35-56-062Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-QQhFhb/home/.smith/runs/2026-05-28T22-34-13-981Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `821279ms`, log `/tmp/smith/2026-05-28T22-49-45-013Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-TZwHwJ/home/.smith/runs/2026-05-28T22-36-04-652Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `010` as recovered. The target trace exercised the new guidance and Smith continued source-side repairs, but the verifier still failed on Alpine scanner helper methods and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `52G` with `74` retained `run-*` directories. Prune stale retained runs after useful evidence is recorded.

## 2026-05-29 Dirty Test Validation Warning

Change:

- When a validation command passes while tracked test files are already modified, Smith now warns that passing results may reflect edited tests.
- The warning asks Smith to preserve existing test behavior too when the user did not ask to update tests.
- This is generic runtime feedback for ordinary git workspaces; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `41` tests.
- Project benchmark `091-command-router-refactor`: passed in `109672ms`, log `/tmp/smith/2026-05-28T22-54-09-610Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-hWSubn/home/.smith/runs/2026-05-28T22-52-20-373Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `686296ms`, log `/tmp/smith/2026-05-28T23-05-40-888Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-gD5e7B/home/.smith/runs/2026-05-28T22-54-15-316Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `010` as recovered. SWE benchmark runs hide `.git` during Smith execution, so this git-based dirty-test warning did not appear in the target trace; the verifier still failed on Alpine scanner API/test compatibility and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `53G` with `76` retained `run-*` directories. Think about pruning stale retained runs from time to time after useful log and trace evidence has been recorded, so `.smith-bench` does not grow unchecked by several more GB.

## 2026-05-29 Cached Go Test Validation Warning

Change:

- When `go test` reports cached package results while a task patch is still pending, Smith now warns that cached test output does not validate the current patch.
- Cached validation no longer clears Smith's pending-validation state or consumes the post-deadline validation slot.
- This is generic validation bookkeeping for Go projects; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `42` tests.
- Project benchmark `091-command-router-refactor`: passed in `70219ms`, log `/tmp/smith/2026-05-28T23-13-01-026Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-cTBT3f/home/.smith/runs/2026-05-28T23-11-51-044Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed by Docker timeout in `915927ms`, log `/tmp/smith/2026-05-28T23-28-22-422Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-LpeU6S/home/.smith/runs/2026-05-28T23-13-17-068Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. The target rerun did not finish on cached `go test`; it used `-count=1`, surfaced real `lib/kube/proxy` test failures, and timed out while still repairing them.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `55G` with `78` retained `run-*` directories. Think about pruning stale retained runs from time to time after useful log and trace evidence has been recorded.

## 2026-05-29 Post-Deadline Failed-Validation Inspection

Change:

- After a post-deadline validation command fails, Smith now keeps `run` available for one short inspection command such as `cat`, `sed`, `rg`, `find`, `ls`, `nl`, or `tail`.
- The inspection slot is capped at `15000ms`, is consumed after one use, and is cleared by the next task patch.
- This is generic runtime behavior for ordinary tasks near a deadline; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `43` tests.
- Project benchmark `091-command-router-refactor`: passed in `70142ms`, log `/tmp/smith/2026-05-28T23-35-48-169Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-deZzsd/home/.smith/runs/2026-05-28T23-34-38-353Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `776569ms`, log `/tmp/smith/2026-05-28T23-48-56-474Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-FL2IL9/home/.smith/runs/2026-05-28T23-36-03-394Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. The target trace did not exercise the new post-deadline inspection slot; Smith finished after an in-run package validation, and the external verifier failed against restored tests with missing `Forwarder.cfg` and `Forwarder.clientCredentials` fields.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `57G` with `80` retained `run-*` directories. Prune stale retained runs periodically after useful commands, logs, traces, and diagnostic snippets are recorded so the folder does not grow unchecked by several GB.

## 2026-05-29 Failed Sub-Agent Transcript Tail

Change:

- `SmithRunFailure` now carries the partial transcript accumulated before a run fails.
- When a `sub_agent` child exhausts its turn budget, the parent receives a bounded recent transcript tail instead of only `sub_agent failed: model did not call finish within N turns`.
- This is generic delegation behavior for ordinary large-codebase work; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `43` tests.
- Project benchmark `091-command-router-refactor`: passed in `270729ms`, log `/tmp/smith/2026-05-28T23-58-16-966Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-0O810u/home/.smith/runs/2026-05-28T23-53-46-492Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `895299ms`, log `/tmp/smith/2026-05-29T00-13-17-512Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-2LKeNT/home/.smith/runs/2026-05-28T23-58-30-324Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. The target trace used the new failed-sub-agent transcript tail and reached `finish`, but the verifier still failed against restored tests with missing `Forwarder.cfg` and `Forwarder.clientCredentials` fields.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `59G` with `82` retained `run-*` directories. Prune stale retained runs periodically after useful commands, logs, traces, and diagnostic snippets are recorded so the folder does not grow unchecked by several GB.

## 2026-05-29 Read-Only Test Patch Finish Guard

Change:

- If a patch has already failed because a likely test/spec file is read-only, Smith now rejects a later `finish` message that still presents the task as complete while citing that read-only test/spec failure.
- The rejection keeps the behavior generic: read-only tests/specs should normally be treated as existing behavior to satisfy through source changes, or reported as a clear blocker/partial result when the requested work truly cannot be completed.
- This does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `44` tests.
- Project benchmark `091-command-router-refactor`: passed in `117036ms`, log `/tmp/smith/2026-05-29T00-20-21-467Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-0bsHky/home/.smith/runs/2026-05-29T00-18-24-673Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `524303ms`, log `/tmp/smith/2026-05-29T00-29-10-376Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-sgmMDz/home/.smith/runs/2026-05-29T00-20-26-848Z.trace`.

Decision:

- Keep the change because it is generic finish-state safety, focused-test covered, build-clean, and project validation passed.
- Do not count `010` as recovered. This specific target rerun did not exercise the new rejection; it failed on missing Alpine compatibility methods (`parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`) and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `61G` with `84` retained `run-*` directories. Prune stale retained runs after their evidence is recorded, while preserving result JSONs and sandboxes still referenced by active diagnosis.

## 2026-05-29 Changed Go Directory Validation Coverage

Change:

- Smith now keeps a task patch pending when a `go test` command validates only some changed Go source directories.
- Example: if patches touched `pkg/a/a.go` and `pkg/b/b.go`, `go test ./pkg/a` warns that `pkg/b` remains uncovered; `go test ./...` clears the pending validation state.
- This is generic validation bookkeeping for ordinary Go projects; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: first concurrent run hit the known build/test `dist` race, then rerun after build passed `45` tests.
- Project benchmark `091-command-router-refactor`: passed in `142378ms`, log `/tmp/smith/2026-05-29T00-36-53-936Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-5K2W7f/home/.smith/runs/2026-05-29T00-34-31-807Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `755904ms`, log `/tmp/smith/2026-05-29T00-49-34-066Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-BF4umo/home/.smith/runs/2026-05-29T00-37-07-070Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. This target rerun did not exercise the changed-directory coverage warning because Smith patched only `lib/service/service.go`; the existing no-op validation warning fired for `go test ./lib/service -run TestNonExistent -count=0`, and Smith honestly finished with a partial blocker.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `63G` with `86` retained `run-*` directories. Prune stale retained runs after their evidence is recorded, while preserving result JSONs and sandboxes still referenced by active diagnosis.

## 2026-05-29 No-Op Validation Finish Guard

Change:

- Smith now tracks when the most recent validation command appeared to run no tests.
- If a later `finish` presents that no-op validation as successful validation, Smith rejects the finish and asks for a validation command that actually executes checks, or an honest pending/not-performed validation report.
- A later non-no-op validation command clears the no-op state, so real validation success can still be reported.
- This is generic validation honesty for ordinary tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `47` tests.
- Project benchmark `091-command-router-refactor`: passed in `124902ms`, log `/tmp/smith/2026-05-29T01-14-55-016Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-vb0AdV/home/.smith/runs/2026-05-29T01-12-50-396Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `755010ms`, log `/tmp/smith/2026-05-29T01-27-38-590Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-f4HWXI/home/.smith/runs/2026-05-29T01-15-09-643Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. This target rerun did not exercise the no-op finish rejection; Smith failed to apply its broad patch because of exact-context mismatches and finished with a blocker reporting no source changes.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `66G` with `90` retained `run-*` directories. Prune stale retained runs after their evidence is recorded, while preserving result JSONs and sandboxes still referenced by active diagnosis.

## 2026-05-29 Post-Deadline Patch Context Inspection

Change:

- Smith now allows one short inspection `run` after a post-deadline patch fails because hunk context no longer matches the current file.
- This reuses the existing post-deadline inspection path and is generic patch-recovery behavior for normal editing tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `48` tests.
- Project benchmark `091-command-router-refactor`: passed in `147204ms`, log `/tmp/smith/2026-05-29T01-34-23-090Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-PD1E92/home/.smith/runs/2026-05-29T01-31-56-311Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `681504ms`, log `/tmp/smith/2026-05-29T01-45-50-268Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-tI3CJl/home/.smith/runs/2026-05-29T01-34-34-517Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `005` as recovered. The target run landed a candidate source patch, but the verifier still failed against restored tests with missing `Forwarder.cfg` and `Forwarder.clientCredentials` fields.
- The target rerun did not clearly exercise the new post-deadline inspection slot; many patch context failures happened before deadline.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup reminder update: `.smith-bench` is now `68G` with `92` retained `run-*` directories. Add a recurring habit to prune stale retained sandboxes from time to time after logs, traces, commands, and diagnostic snippets have been recorded, so `.smith-bench` does not silently grow by several more GB. Preserve any sandbox still referenced by active diagnosis.

## 2026-05-29 Explicit Requirements Checklist Reminder

Change:

- Smith now adds a generic initial checklist reminder when the user prompt contains an explicit requirements, acceptance criteria, todo, or checklist section.
- The reminder tells Smith to track each requested item and only finish as complete when each item is implemented, validated, or explicitly reported incomplete/blocked.
- This is generic task-following behavior for normal user requests; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `49` tests after rerunning separately from build to avoid the known `dist` race.
- Project benchmark `091-command-router-refactor`: passed in `118481ms`, log `/tmp/smith/2026-05-29T01-52-58-993Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-r2QRN4/home/.smith/runs/2026-05-29T01-51-00-768Z.trace`.
- First target `010-future-architect-vuls` attempt failed before result collection with `smith: ENOSPC: no space left on device, write`.
- After approved cleanup of stale retained `.smith-bench/run-*` sandboxes, target `010-future-architect-vuls` failed after verifier in `426690ms`, log `/tmp/smith/2026-05-29T05-28-49-728Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-se1orY/home/.smith/runs/2026-05-29T05-21-44-107Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and project validation passed.
- Do not count `010` as recovered. The rerun finished with an honest blocker and no source patch; the verifier still failed on missing Alpine parser methods and `TestIsOvalDefAffected`.
- Evidence improved from a false completion claim to an explicit incomplete-requirements report, but strict score evidence remains `6/10`; full suite is still not justified.
- Cleanup action: removed stale retained `.smith-bench/run-*` sandboxes after `ENOSPC`, preserving the currently referenced diagnostic runs. `.smith-bench` is now `3.4G` with `5` retained `run-*` directories. Continue pruning stale retained runs periodically after logs and diagnostic snippets are recorded.

## 2026-05-29 Longer No-Patch Inspection Window

Change:

- Smith now waits for a third no-patch progress interval before temporarily disabling inspection tools: `36` tool calls instead of `24`.
- The 12-call progress reminders remain unchanged.
- This is generic pacing for complex tasks that need broader initial investigation before a safe first patch; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `49` tests.
- Project benchmark `091-command-router-refactor`: passed in `197518ms`, log `/tmp/smith/2026-05-29T05-35-45-158Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-xX1O8q/home/.smith/runs/2026-05-29T05-32-28-228Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `841956ms`, log `/tmp/smith/2026-05-29T05-49-53-464Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-NtUGCH/home/.smith/runs/2026-05-29T05-35-52-272Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, project validation passed, and it changed `010` from an early blocker to a source-patched attempt.
- Do not count `010` as recovered. The verifier still failed on missing Alpine parser method wrappers and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Cleanup status: `.smith-bench` is `4.8G` with `7` retained `run-*` directories after this run.

## 2026-05-29 Fresh 008 Diagnostic

Evidence:

- Current Smith rerun of `008-future-architect-vuls`: failed by outer timeout after `906886ms`, log `/tmp/smith/2026-05-29T06-06-53-481Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-IAADH4/home/.smith/runs/2026-05-29T05-51-48-218Z.trace`.
- Smith applied a late source patch to `models/cvecontents.go` but did not reach validation or finish before the benchmark timeout.
- Retained diff: `models/cvecontents.go | 134 +++++++++++++++++++++++++++++++++++++++++++++++++-`.

Decision:

- Do not count `008` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Next generic hypothesis: the deadline/progress policy still lets complex investigations defer the first patch until too late for validation. Any change must stay generic and avoid benchmark-specific timing or task instructions.

## 2026-05-29 Rejected Deadline Finalization Experiment

Evidence:

- Tried a generic runtime-only idea: start deadline finalization before `max_run_ms` instead of waiting for the configured max run time to fully elapse. This did not add benchmark-specific prompt text or task-specific logic.
- At a `95%` finalization threshold, focused validation passed: `npm run build`, `npm test -- tests/integration.test.ts`, and project benchmark `091-command-router-refactor` passed in `202900ms`, log `/tmp/smith/2026-05-29T06-14-19-231Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-9QHBZh/home/.smith/runs/2026-05-29T06-10-56-609Z.trace`.
- Target `008-future-architect-vuls` still failed by outer timeout after `906075ms`, log `/tmp/smith/2026-05-29T06-29-36-384Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-RtuHl0/home/.smith/runs/2026-05-29T06-14-30-998Z.trace`.
- Trace evidence showed `95%` finalization was too late to affect the decisive model response: Smith reached the 90% reminder at `12m 1s of 12m 45s`, had only `patch` and `finish` available, then the model response ran into the outer timeout before another Smith turn could apply finalization.
- Tightening the same idea to `90%` failed the representative project benchmark `091-command-router-refactor`: verifier exit code `1`, log `/tmp/smith/2026-05-29T06-36-02-524Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-J8U99Q/home/.smith/runs/2026-05-29T06-31-14-760Z.trace`.

Decision:

- Reverted the deadline-finalization code experiment and kept no source changes from it.
- Do not rerun SWE with the `90%` version because the required project-task validation failed.
- Do not count `008` as recovered. Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `4.9G` after the retained diagnostic runs. Continue pruning stale retained sandboxes after their command, log path, trace path, sandbox path, and conclusions are copied into these logs.

## 2026-05-29 Root Test File Validation Is Narrow

Change:

- Smith now treats direct single-file `node test.js` style validation as narrow validation, matching the existing handling for explicit test file paths like `tests/foo.test.js`.
- This is a generic validation-quality rule for normal coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `50` tests.
- Hard representative `091-command-router-refactor` was attempted twice with this change but did not produce a clean validation signal: one run timed out after an accidental bad patch deleted `src/router.js`, and one hit a provider request timeout. Because the change specifically concerns `node test.js`, a smaller relevant project task was used instead.
- Relevant project benchmark `025-command-alias-support`: passed in `199184ms`, log `/tmp/smith/2026-05-29T06-55-00-796Z-smith-025-command-alias-support.json`, trace `.smith-bench/run-bWUc6G/home/.smith/runs/2026-05-29T06-51-42-100Z.trace`.
- Target SWE rerun `008-future-architect-vuls`: failed by outer timeout after `906138ms`, log `/tmp/smith/2026-05-29T07-10-20-610Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-9NsEGY/home/.smith/runs/2026-05-29T06-55-15-430Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, and passed a relevant local benchmark that uses `node test.js` plus a broader verifier.
- Do not count `008` as recovered. The run reached a source-patched and validation-failed state, but still timed out before a correct final patch.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `5.1G` with `15` retained `run-*` directories. Continue periodic cleanup after evidence is copied forward.

## 2026-05-29 Failed Validation Follow-Up Inspection Nudge

Change:

- Failed validation output now explicitly tells Smith to inspect referenced files or failure locations before follow-up patches.
- This is generic recovery guidance for normal coding tasks after failed tests/builds; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `50` tests.
- Relevant project benchmark `025-command-alias-support`: passed in `124187ms`, log `/tmp/smith/2026-05-29T07-15-24-973Z-smith-025-command-alias-support.json`, trace `.smith-bench/run-yorD88/home/.smith/runs/2026-05-29T07-13-21-010Z.trace`.
- Target SWE rerun `008-future-architect-vuls`: failed by outer timeout after `907939ms`, log `/tmp/smith/2026-05-29T07-30-39-873Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-t6gtq8/home/.smith/runs/2026-05-29T07-15-32-909Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, and project validation passed.
- Do not count `008` as recovered. The run surfaced the new failed-validation wording after a source patch, but timed out before acting on it.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `5.3G` with `17` retained `run-*` directories. Continue periodic cleanup after evidence is copied forward.

## 2026-05-29 Compound Validation Command Classification

Change:

- Smith now treats compound commands that start with inspection but later run validation, such as `sed ... && npm test`, as validation commands.
- Plain inspection commands still remain inspection. This is generic command classification for normal timed runs; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `51` tests.
- Relevant project benchmark `025-command-alias-support`: passed in `66844ms`, log `/tmp/smith/2026-05-29T07-35-19-378Z-smith-025-command-alias-support.json`, trace `.smith-bench/run-Xz2BSJ/home/.smith/runs/2026-05-29T07-34-12-941Z.trace`.
- Target SWE rerun `008-future-architect-vuls`: failed after verifier in `817568ms`, log `/tmp/smith/2026-05-29T07-49-06-836Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-TLFgPl/home/.smith/runs/2026-05-29T07-35-30-000Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, project validation passed, and moved `008` from repeated outer timeouts to a verifier failure.
- Do not count `008` as recovered. The verifier still failed `TestParse`, primarily on nil-vs-empty `Cpes`/`CweIDs` differences in Trivy parser expected output.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `5.5G` with `19` retained `run-*` directories. Continue periodic cleanup after evidence is copied forward.

## 2026-05-29 Fresh 010 Diagnostic After Validation Improvements

Evidence:

- Current Smith rerun of `010-future-architect-vuls`: failed by outer timeout after `906259ms`, log `/tmp/smith/2026-05-29T08-06-34-584Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-BDdcJO/home/.smith/runs/2026-05-29T07-51-29-088Z.trace`.
- Smith patched `scanner/alpine.go` and iterated through multiple focused scanner validations.
- Retained diff: `scanner/alpine.go | 176 ++++++++++++++++++++++++++++++++++++++++++++----------`.
- Late validation failure had narrowed to `TestParseApkVersion`, after earlier missing wrapper/build failures were addressed.

Decision:

- Do not count `010` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Next generic hypothesis: Smith benefits from failed-validation inspection guidance, but still spends too long iterating large hand-written parser patches near the timeout. Any follow-up change must stay generic, likely around validation-loop pacing or source-compatible wrapper preservation, not Vuls-specific parser rules.
- `.smith-bench` is about `6.8G` with `20` retained `run-*` directories. Continue periodic cleanup after evidence is copied forward.

## 2026-05-29 Validation Integrity For Modified Tests

Change:

- Smith now includes untracked test files when checking whether validation ran against modified tests.
- A source patch is no longer marked fully validated when the passing validation command ran while test files were modified or newly added.
- Simple `printf` and `echo` label segments are treated as inspection segments, so commands like `grep ... && printf '--- test harness ---' && sed ...` are not misclassified as validation just because a label contains the word `test`.
- This is generic validation bookkeeping for normal coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `52` tests.
- Relevant project benchmark `025-command-alias-support`: passed in `231396ms`, log `/tmp/smith/2026-05-29T08-34-36-004Z-smith-025-command-alias-support.json`, trace `.smith-bench/run-L8rIU4/home/.smith/runs/2026-05-29T08-30-44-997Z.trace`.
- First target diagnostic before the `printf`/`echo` classifier fix: `008-future-architect-vuls` timed out after `906036ms`, log `/tmp/smith/2026-05-29T08-29-01-966Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-LJ1R5s/home/.smith/runs/2026-05-29T08-13-56-645Z.trace`.
- Target SWE rerun after the classifier fix: `008-future-architect-vuls` passed in `864126ms`, log `/tmp/smith/2026-05-29T08-49-06-027Z-smith-008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904.json`, trace `.smith-bench/run-0KN9kr/home/.smith/runs/2026-05-29T08-34-42-829Z.trace`.
- The external verifier ran selected `TestParse` and reported `{"passed": 1}`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, passed a relevant project benchmark, and produced a clean `008` recovery under the raw-prompt path.
- Current strict targeted evidence remains `6/10`: baseline full-run passes `002`, `004`, `007` plus recovered `001`, `003`, and `008`. One more Codex-passed Smith failure, likely `005` or `010`, is still needed before a full SWE-bench Pro run is justified.
- `.smith-bench` is about `7.0G` with `24` retained `run-*` directories. Continue periodic cleanup after evidence is copied forward.

## 2026-05-29 Generic Incomplete-Finish Guard

Change:

- Smith now rejects a `finish` message when the original prompt has explicit requirements and the finish report says requested items remain incomplete without a concrete blocker.
- The guard is intentionally generic: it applies to ordinary tasks with requirement/checklist sections, does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing, and does not add benchmark-specific prompt content.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `53` tests after a sequential rerun. The initial parallel build/test attempt exposed a stale CLI race and was discarded.
- Representative project benchmark `091-command-router-refactor`: passed in `123904ms`, log `/tmp/smith/2026-05-29T09-24-45-221Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-kVLPPg/home/.smith/runs/2026-05-29T09-22-41-879Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed by outer timeout after `914461ms`, log `/tmp/smith/2026-05-29T09-40-08-282Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-JPRH6W/home/.smith/runs/2026-05-29T09-25-02-976Z.trace`.

Decision:

- Keep the change because it is a generic task-completion integrity guard and passed focused plus representative validation.
- Do not count `005` as recovered. The stricter guard prevented an incomplete early finish and forced real implementation work, but the run timed out after failed large follow-up patches.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `13G` with `29` retained `run-*` directories. Cleanup is now a recurring maintenance need: after copying evidence into the logs, periodically prune stale retained sandboxes and keep only current diagnostic or leaderboard-evidence runs.

## 2026-05-29 Generic Patch Failure Context And Inspection-Finish Guard

Change:

- Patch context failures now include a short preview of the unmatched hunk context when Smith cannot find nearby file context. This preserves actionable retry information after prior patch bodies are compacted out of provider history.
- Smith now rejects `finish` messages that say more inspection or diagnosis is needed while `run` is still available. This is generic loop integrity for ordinary coding tasks; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/patch.test.ts`: passed `10` tests.
- `npm test -- tests/integration.test.ts`: passed `54` tests after rebuilding. The first integration run used stale built CLI output and failed the new test, then passed after `npm run build`.
- First representative project benchmark `091-command-router-refactor`: failed by timeout in `303863ms`, log `/tmp/smith/2026-05-29T09-49-00-896Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-AeEZu8/home/.smith/runs/2026-05-29T09-43-57-398Z.trace`. This exposed the generic actionable-inspection finish issue.
- Final representative project benchmark `091-command-router-refactor`: passed in `215051ms`, log `/tmp/smith/2026-05-29T09-54-56-194Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-P3xsPQ/home/.smith/runs/2026-05-29T09-51-21-365Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed after verifier in `883616ms`, log `/tmp/smith/2026-05-29T10-09-44-721Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-E5vKcp/home/.smith/runs/2026-05-29T09-55-07-385Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and the final local benchmark passed.
- Do not count `005` as recovered. The actionable-inspection guard fired, but final verifier still failed because `Forwarder` lacks `cfg` and `clientCredentials` compatibility fields expected by restored tests.
- The patch hunk-preview path was not exercised in the final `005` rerun, but remains a generic patch-tool improvement covered by unit tests.
- Current strict targeted evidence remains `6/10`; full suite is still not justified. Rotate to `010` or a different Codex-passed failure before spending another full run.
- `.smith-bench` is about `15G` with `32` retained `run-*` directories. Cleanup should happen soon after preserving the current evidence paths.

## 2026-05-29 Fresh 010 Diagnostic After Generic Recovery Guards

Evidence:

- Current Smith rerun of `010-future-architect-vuls`: failed after verifier in `992975ms`, log `/tmp/smith/2026-05-29T10-27-47-067Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-7Dgc6b/home/.smith/runs/2026-05-29T10-11-14-913Z.trace`.
- Smith patched `scanner/alpine.go` and locally validated `go test -count=1 ./scanner ./oval ./models`, then finished claiming success.
- External verifier failed because restored tests still call `parseApkInstalledList`, `parseApkIndex`, and `parseApkUpgradableList`; `TestIsOvalDefAffected` also regressed.

Decision:

- Do not count `010` as recovered.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- Next generic hypothesis: Smith needs stronger source-compatibility preservation during helper/parser refactors, especially when existing tests or callers may still use old private methods. Any change must be generic and not Vuls-specific.
- `.smith-bench` is about `16G` with `33` retained `run-*` directories. Cleanup remains urgent after preserving current evidence paths.

## 2026-05-29 Generic Declaration-Removal Compatibility Warning

Change:

- Patch output now warns when a patch removes or renames function/class declarations, asking Smith to search for remaining callers or keep compatibility wrappers before treating validation as complete.
- This is a generic refactor safety signal for ordinary coding tasks, not benchmark-specific logic.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `55` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `162417ms`, log `/tmp/smith/2026-05-29T10-32-38-483Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-b8b02j/home/.smith/runs/2026-05-29T10-29-56-539Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `931599ms`, log `/tmp/smith/2026-05-29T10-48-15-618Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-IA4eIM/home/.smith/runs/2026-05-29T10-32-44-817Z.trace`.

Decision:

- Keep the change because it is generic, covered by integration tests, and passed local validation.
- Do not count `010` as recovered. The new warning was not exercised in this target run because Smith did not remove old declarations in the patch; it failed to add expected wrapper methods. Verifier still failed on missing `parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`, and `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `18G` with `35` retained `run-*` directories. Cleanup is urgent after the current evidence paths are preserved.

## 2026-05-29 Contradictory Finish Guard

Change:

- Smith now rejects finish messages that claim the task is done while also reporting incomplete or blocked requested work.
- This is generic completion-quality behavior for ordinary tasks, not benchmark-specific prompting.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `56` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `191158ms`, log `/tmp/smith/2026-05-29T10-54-31-275Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-kAfizk/home/.smith/runs/2026-05-29T10-51-20-603Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed after verifier in `981846ms`, log `/tmp/smith/2026-05-29T11-11-00-546Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-YZjHnm/home/.smith/runs/2026-05-29T10-54-39-537Z.trace`.

Decision:

- Keep the guard because it is generic, focused-test covered, and project validation passed.
- Do not count `010` as recovered. The guard avoided the previous `Done` + incomplete finish shape, but Smith still ended with a partial/read-only-test blocker and the verifier still failed on missing `parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`, plus `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `18G` with `37` retained `run-*` directories. Prune stale retained sandboxes soon after preserving the latest evidence.

## 2026-05-29 Read-Only Test Blocker Guard

Change:

- Smith now rejects finish messages that present a read-only test/spec patch failure as the blocker when the original user prompt did not ask to edit tests.
- This is a generic source-compatibility behavior: existing tests/specs should usually be treated as behavior to satisfy through source changes, not as an accepted blocker merely because they are read-only.
- The change does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `57` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `91272ms`, log `/tmp/smith/2026-05-29T11-16-26-926Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-bangHI/home/.smith/runs/2026-05-29T11-14-55-952Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed by Docker timeout after `905943ms`, log `/tmp/smith/2026-05-29T11-31-38-750Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-BELb6l/home/.smith/runs/2026-05-29T11-16-33-552Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and passed representative project validation.
- Do not count `010` as recovered. The latest target run timed out before verifier completion; the new guard did not appear to fire before timeout.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `19G` with `39` retained `run-*` directories. Add regular cleanup to the operating checklist: preserve current evidence paths, then prune stale retained sandboxes before the folder grows by several more GB.

## 2026-05-29 Missing Declaration Validation Hint

Change:

- Failed validation output now adds a generic compatibility hint when a pending source patch is followed by missing declaration/member/symbol errors.
- The hint asks Smith to search referenced names and existing callers, then add or restore source declarations or compatibility wrappers when appropriate.
- This is generic compiler/test failure recovery; it does not mention SWE-bench, task IDs, selected tests, verifiers, scoring, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `58` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `134485ms`, log `/tmp/smith/2026-05-29T11-37-12-346Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-nprULK/home/.smith/runs/2026-05-29T11-34-58-109Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed in `643176ms` with `smith: shell is closed`, log `/tmp/smith/2026-05-29T11-48-01-933Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-pFhVQe/home/.smith/runs/2026-05-29T11-37-19-456Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and passed representative project validation.
- Do not count `010` as recovered. This target run did not patch files or reach validation, so the new hint was not exercised.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `19G` with `41` retained `run-*` directories. Cleanup is now part of the explicit next-step checklist after preserving `run-nprULK` and `run-pFhVQe`.

## 2026-05-29 PTY Exit Isolation

Change:

- Smith's PTY shell runner now wraps commands containing a standalone `exit` in a subshell so the command's exit status is preserved without closing Smith's persistent interactive shell.
- This is a generic runtime reliability fix for ordinary shell commands; it does not alter benchmark prompts, selected tests, verifiers, scoring, parsers, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/pty.test.ts tests/integration.test.ts`: passed `60` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `123087ms`, log `/tmp/smith/2026-05-29T11-52-33-933Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-ykT9b9/home/.smith/runs/2026-05-29T11-50-31-328Z.trace`.
- First target retry `010-future-architect-vuls`: failed early in `159294ms` with `smith: provider request failed: fetch failed`, log `/tmp/smith/2026-05-29T11-55-19-201Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-pP67Sj/home/.smith/runs/2026-05-29T11-52-40-863Z.trace`. This was treated as infrastructure noise, not target evidence.
- Second target retry `010-future-architect-vuls`: reached verifier and failed in `956356ms`, log `/tmp/smith/2026-05-29T12-51-37-081Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-b4JRst/home/.smith/runs/2026-05-29T12-35-41-495Z.trace`.

Decision:

- Keep the change because it fixes a real generic runtime failure (`exit` closing the persistent shell), is focused-test covered, build-clean, and passed representative project validation.
- Do not count `010` as recovered. The target no longer failed with `shell is closed`, but verifier still failed on missing `parseApkInstalledList`, `parseApkIndex`, `parseApkUpgradableList`, plus `TestIsOvalDefAffected`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `20G` with `44` retained `run-*` directories. Cleanup should happen before more multi-run sweeps after preserving `run-ykT9b9`, `run-pP67Sj`, and `run-b4JRst`.

## 2026-05-29 Unvalidated Validation-Claim Guard

Change:

- Smith now rejects finish messages that claim successful validation while a task patch is still tracked as unvalidated.
- Smith also recognizes `validation is pending` and `validation remains pending` as honest pending-validation reports.
- This is generic final-answer integrity for ordinary coding tasks; it does not alter benchmark prompts, selected tests, verifiers, scoring, parsers, or result parsing.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `59` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `139376ms`, log `/tmp/smith/2026-05-29T13-00-03-033Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-qZvKGl/home/.smith/runs/2026-05-29T12-57-44-052Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed by Docker timeout after `906345ms`, log `/tmp/smith/2026-05-29T13-15-18-703Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-Y8LeVK/home/.smith/runs/2026-05-29T13-00-13-124Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and passed representative project validation.
- Do not count `010` as recovered. The run timed out while still trying to repair Alpine source changes after failed validation; no verifier pass.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `22G` with `46` retained `run-*` directories. Cleanup is now urgent before additional target runs.

## 2026-05-29 Declaration Signature Compatibility Note

Change:

- Smith now adds a generic patch-output compatibility note when a patch changes same-name function declaration signatures.
- The note asks Smith to search existing callers and keep wrappers or adapters when old signatures may still be used.
- This is a general source-compatibility guard for ordinary refactors; it does not mention SWE-bench, task IDs, benchmark runtimes, selected tests, verifiers, scoring, result parsing, or any task-specific implementation details.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `60` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `208893ms`, log `/tmp/smith/2026-05-29T13-24-14-447Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-vxpbw4/home/.smith/runs/2026-05-29T13-20-45-836Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed by Docker timeout after `905999ms`, log `/tmp/smith/2026-05-29T13-39-30-459Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-sbbHYK/home/.smith/runs/2026-05-29T13-24-25-132Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and passed representative project validation.
- Do not count `010` as recovered. The new note fired for changed `scanInstalledPackages` and `parseApkInfo` signatures, but Smith still timed out after late compatibility repair attempts, read-only test-file patch attempts, and patch-context failures.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `23G` with `48` retained `run-*` directories. Before more expensive runs, preserve current evidence paths and prune stale retained sandboxes so the folder does not keep growing by several GB.

## 2026-05-29 Signature Mismatch Validation Hint

Change:

- Failed validation output now adds a generic compatibility hint when source changes are followed by argument, assignment, or return-value mismatch errors.
- The hint favors small source compatibility fixes: update call sites if a new signature is intentional, or keep wrappers/adapters for existing callers.
- This is ordinary validation-output analysis; it does not mention SWE-bench, task IDs, benchmark runtimes, selected tests, verifiers, scoring, result parsing, or any target-specific implementation detail.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts`: passed `61` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `80364ms`, log `/tmp/smith/2026-05-29T13-44-52-727Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-znPOXG/home/.smith/runs/2026-05-29T13-43-32-590Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed verifier in `851098ms`, log `/tmp/smith/2026-05-29T13-59-17-188Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-MTRPgg/home/.smith/runs/2026-05-29T13-45-06-863Z.trace`.

Decision:

- Keep the change because it is generic, focused-test covered, build-clean, and passed representative project validation.
- Do not count `010` as recovered. The new hint did not fire in the target run because Smith did not run validation after its final source patch; the benchmark verifier later found `assignment mismatch` and `undefined: srcPacks`.
- Current strict targeted evidence remains `6/10`; full suite is still not justified.
- `.smith-bench` is about `23G` with `50` retained `run-*` directories. Cleanup is urgent before further expensive runs: preserve `run-znPOXG` and `run-MTRPgg`, then prune stale retained sandboxes.

## 2026-05-29 Post-Deadline Run Slot Availability Fix

Change:

- Fixed a generic tool-availability bug where inspection pause could remove `run` even after Smith later promised a bounded post-deadline validation or inspection run slot.
- The fix keeps `sub_agent` disabled in paused/deadline states, but allows `run` when a specific post-deadline run slot exists.
- Added regression coverage for a paused-inspection state followed by a late patch-context failure; the next provider turn now exposes `run`, `patch`, and `finish`.
- Dropped the uncommitted struct-field compatibility warning idea because it was a prompt-style nudge with weak target evidence and could be read as too benchmark-motivated under the user's stricter no-cheating guidance.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "keeps post-deadline inspection available"`: passed `1` selected test.
- `npm test -- tests/integration.test.ts`: passed `62` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `170535ms`, log `/tmp/smith/2026-05-29T14-33-34-452Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-FiFTH4/home/.smith/runs/2026-05-29T14-30-44-231Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed verifier in `822575ms`, log `/tmp/smith/2026-05-29T14-47-24-410Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-8SAcEl/home/.smith/runs/2026-05-29T14-33-49-112Z.trace`.

Decision:

- Keep the runtime fix because it resolves a concrete generic inconsistency between promised and exposed tools, is regression-tested, build-clean, and passed representative project validation.
- Do not count `005` as recovered. The target retry did not trigger the fixed post-deadline inspection path; Smith paused inspection, edited only `lib/kube/proxy/auth.go`, then finished blocked before resolving the broader proxy/test compatibility failure.
- Current strict targeted evidence remains `6/10`; full SWE-bench Pro is still not justified.
- `.smith-bench` is now about `26G` with `54` retained `run-*` directories. Add a recurring maintenance note: after each committed milestone, preserve the newest evidence sandboxes and prune stale retained runs before the folder grows by several more GB.

## 2026-05-29 Keep Validation Available After Pending Patch

Change:

- Sustained-inspection throttling no longer removes `run` while a non-memory task patch is still pending validation.
- This is a generic runtime invariant: Smith should not make validation impossible after it changes source files.
- Added integration coverage for a patch followed by 36 inspection commands; the next turn still exposes `run` and the progress reminder reports `run` as available.

Validation:

- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "keeps run available after sustained inspection"`: passed `1` selected test.
- `npm test -- tests/integration.test.ts`: passed `63` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `203255ms`, log `/tmp/smith/2026-05-29T14-56-31-240Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-w0btlq/home/.smith/runs/2026-05-29T14-53-08-519Z.trace`.
- Target SWE rerun `005-gravitational-teleport`: failed by outer Docker timeout after `918222ms`, log `/tmp/smith/2026-05-29T15-12-01-461Z-smith-005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037.json`, trace `.smith-bench/run-AtY13d/home/.smith/runs/2026-05-29T14-56-56-184Z.trace`.

Decision:

- Keep the change because it fixes a generic validation-availability failure and was exercised in the `005` trace.
- Do not count `005` as recovered. Evidence improved from an early unvalidated blocker to a run that kept `run` available, ran `go test ./lib/service ./lib/events/filesessions ./lib/kube/proxy`, made a later source patch, then timed out before a final verifier result.
- Current strict targeted evidence remains `6/10`; full SWE-bench Pro is still not justified.
- `.smith-bench` is now about `28G` with `56` retained `run-*` directories. Cleanup should happen soon: preserve `run-w0btlq` and `run-AtY13d` for this milestone, then prune stale retained sandboxes with explicit approval.

## 2026-05-29 Finish Guard Tightening for Available Validation

Change:

- Finish rejection now catches combined “no inspection/validation tool” claims when `run` is actually available.
- Finish rejection now treats a prior read-only test/spec patch failure as still relevant even if a later completion claim omits the read-only detail.
- This is generic finish-integrity behavior for ordinary coding tasks; it does not mention benchmark tasks, selected tests, scoring, result parsing, or target implementation details.

Validation:

- Approved cleanup pruned stale retained sandboxes from `.smith-bench`: `28G` / `56` runs down to `4.9G` / `8` runs before new validation.
- Diagnostic current-code `010-future-architect-vuls` rerun before edits still failed verifier in `992376ms`, log `/tmp/smith/2026-05-29T17-35-17-175Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-ib0Jjd/home/.smith/runs/2026-05-29T17-18-45-656Z.trace`.
- `npm run build`: passed.
- `npm test -- tests/integration.test.ts -t "combined inspection-validation unavailable"`: passed `1` selected test.
- `npm test -- tests/integration.test.ts -t "combined inspection-validation unavailable|omit an earlier read-only test"`: passed `2` selected tests.
- `npm test -- tests/integration.test.ts`: passed `65` tests.
- Representative project benchmark `091-command-router-refactor`: passed in `199723ms`, log `/tmp/smith/2026-05-29T18-03-23-005Z-smith-091-command-router-refactor.json`, trace `.smith-bench/run-CCZuQc/home/.smith/runs/2026-05-29T18-00-03-548Z.trace`.
- Target SWE rerun `010-future-architect-vuls`: failed by outer Docker timeout after `906067ms`, log `/tmp/smith/2026-05-29T18-18-44-474Z-smith-010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a.json`, trace `.smith-bench/run-mFbpeO/home/.smith/runs/2026-05-29T18-03-39-197Z.trace`.

Decision:

- Keep the change because it closes generic false-finish gaps with focused regression coverage and representative benchmark validation.
- Do not count `010` as recovered. The target improved across diagnostics from an unused-import verifier failure to source-only scanner work, but the latest run timed out while repairing scanner parsing/test compatibility and patch-context mismatches.
- Current strict targeted evidence remains `6/10`; full SWE-bench Pro is still not justified.
- `.smith-bench` is now about `9.0G` with `13` retained `run-*` directories after the new runs. Preserve `run-ib0Jjd`, `run-xFserO`, `run-mFbpeO`, and `run-CCZuQc` for this milestone; prune stale runs again before another long sequence.
