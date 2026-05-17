# Benchmark Iteration Notes

## 2026-05-16: Session Log Milestone

Goal: make single-task benchmark failures inspectable without relying on terminal scrollback.

Implemented log mode through `--log-dir`, `runtime.log_dir`, and `SMITH_LOG_DIR`. The benchmark runner writes one redacted JSON log per task under the selected directory, typically `/tmp/smith`, with task id, command, stdout/stderr, trace path, sandbox path, usage, verifier output/status, model outputs, terminal outputs, final `chat_out`, and compact parsed provider event summaries.

Design decisions:

- Kept this as a flag/config/env path instead of a new CLI subcommand.
- Wrote benchmark logs from the host runner so Docker container `/tmp` state is not lost.
- Reused the existing trace as the source of model/terminal evidence and added parsed provider event summaries to traces.
- Redacted common token, authorization, API key, secret, and password fields before writing JSON logs.

Validation commands:

```sh
npm run build
npm test
```

Next iteration should run one Smith benchmark with:

```sh
node bin/smith.js benchmark run benchmarks/<task> --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

## 2026-05-16: First Single-Task Run

Command:

```sh
node bin/smith.js benchmark run benchmarks/011-parse-port-default --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Result: passed in 44.0s, 8 turns, 18,041 total tokens. Log: `/tmp/smith/2026-05-16T15-58-12-888Z-smith-011-parse-port-default.json`. Trace: `.smith-bench/run-kjfGPE/home/.smith/runs/2026-05-16T15-57-29-247Z.trace`.

Evidence-backed follow-up improvements:

- Parsed provider event logging was too verbose because function-call arguments were recorded one streaming delta at a time. Changed event summaries to skip delta events and keep completed/high-level events.
- Terminal outputs contained bracketed-paste/ANSI escape sequences, polluting traces and future transcript context. PTY normalization now strips CSI escape sequences before transcript/log storage.
- Silent successful verifier/test commands produced no explicit success signal, causing Smith to rerun `node test.js && bash /task/verify.sh`. The PTY runner now captures `$?` after prompt return and terminal turns include `exit_status: N`.

Rerun command:

```sh
node bin/smith.js benchmark run benchmarks/012-slugify-edge-cases --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Rerun result: passed in 13.4s, 5 turns, 5,652 total tokens. Log: `/tmp/smith/2026-05-16T16-02-41-201Z-smith-012-slugify-edge-cases.json`. The verifier command ran once and its terminal output was `exit_status: 0`.

## 2026-05-16: Reporting Task Exactness

Command:

```sh
node bin/smith.js benchmark run benchmarks/001-release-note-summary --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Result: passed, but logs showed avoidable verifier failures. Smith paraphrased or formatted expected literals (`payments retry fix`, `rollback flag receipt_v2`) as capitalized prose or with backticks, then needed extra turns to converge. This is a prompt misunderstanding / verifier-use issue, not task-specific logic.

General improvement: the system prompt now tells Smith to preserve exact identifiers, flags, filenames, and expected literal strings from source files and verifier errors in generated code, docs, and reports.

The same run also exposed remaining status-probe echo text after heredoc-plus-verifier commands. The PTY status probe now prints sentinel values via shell variables and strips the probe command after normalized output.

Rerun result after the first prompt change: passed, but still failed once because Smith invented `Release Note Summary` instead of carrying over the source version label `Release 2.4`. The prompt now specifically tells Smith to prefer source headings/version labels for generated report headings and to copy factual bullet phrases exactly before adding explanatory prose.

Rerun result after the heading guidance: passed, but still failed once because Markdown backticks around `receipt_v2` broke the exact phrase `rollback flag receipt_v2`. The prompt now explicitly says not to add Markdown backticks, quotes, capitalization changes, or punctuation inside text that must be preserved exactly.

Rerun result after the no-backticks rule: passed in 26.7s, 8 turns, 14,747 total tokens. Log: `/tmp/smith/2026-05-16T16-11-27-987Z-smith-001-release-note-summary.json`. No exact-literal verifier failure occurred. Remaining turn overhead came from optional self-check commands (`git diff` in a non-git sandbox and a brittle `printf` label), so the next general improvement should target shell command robustness rather than report exactness.

## 2026-05-16: Shell Script Task

Command:

```sh
node bin/smith.js benchmark run benchmarks/041-safe-clean-script --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Result: passed in 20.8s, 6 turns, 7,374 total tokens. Log: `/tmp/smith/2026-05-16T16-13-16-200Z-smith-041-safe-clean-script.json`. Smith inspected the script and verifier, applied a focused `smith_patch`, and verified once. No new failure class appeared.

## 2026-05-16: Config Inventory Shell Robustness

Command:

```sh
node bin/smith.js benchmark run benchmarks/002-config-inventory --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Baseline result: passed in 20.8s, 6 turns, 8,303 total tokens. Log: `/tmp/smith/2026-05-16T19-58-21-224Z-smith-002-config-inventory.json`. Trace: `.smith-bench/run-l07HEC/home/.smith/runs/2026-05-16T19-58-00-593Z.trace`.

Observed inefficiencies and classifications:

- The run still used separator labels that had previously failed when written as `printf '--- label ---\n'`. Classification: shell/PTY issue.
- The run repeated source inspection in adjacent turns on a small unchanged workspace. Classification: weak inspection / context pollution.
- A follow-up rerun after only shell guidance avoided brittle labels and guarded `git`, but missed the source heading literal `Runtime Config` and needed verifier recovery. Classification: prompt misunderstanding / verifier use.
- Later reruns showed optional `.git` probing and status checks after edits. Classification: weak inspection / shell self-check inefficiency.

General improvements:

- The system prompt now tells Smith to reuse existing terminal output, avoid `git status`, `git diff`, and `.git` probes as default self-checks in scratch/benchmark workspaces, and use `printf '%s\n' '--- label ---'` for dash-prefixed labels.
- Report guidance now requires source top-level Markdown headings or version labels to appear verbatim in the generated report heading or first bullet.
- Benchmark task instructions are shared through `BENCHMARK_TASK_INSTRUCTIONS` and now tell agents to run the verifier directly after focused edits, avoiding optional status, diff, or `.git` self-checks unless diagnosing a concrete failure.

Rerun progression:

- After initial shell guidance: passed in 29.3s, 9 turns, 15,068 tokens. Log: `/tmp/smith/2026-05-16T20-03-07-866Z-smith-002-config-inventory.json`. Trace: `.smith-bench/run-CCznb3/home/.smith/runs/2026-05-16T20-02-38-859Z.trace`. It avoided brittle `printf` but failed once on missing `Runtime Config`.
- After explicit source-heading guidance: passed in 17.2s, 7 turns, 10,101 tokens. Log: `/tmp/smith/2026-05-16T20-04-41-135Z-smith-002-config-inventory.json`. Trace: `.smith-bench/run-ZIOcyi/home/.smith/runs/2026-05-16T20-04-24-160Z.trace`. No verifier failure, no `git` command, but still some optional checking.
- After shared benchmark self-check guidance: passed in 17.7s, 7 turns, 9,787 tokens. Log: `/tmp/smith/2026-05-16T20-06-15-732Z-smith-002-config-inventory.json`. Trace: `.smith-bench/run-EU37qH/home/.smith/runs/2026-05-16T20-05-58-255Z.trace`. No brittle labels, but it still probed `.git`.
- After stronger no-git-probe guidance: passed in 25.6s, 7 turns, 10,790 tokens. Log: `/tmp/smith/2026-05-16T20-07-24-204Z-smith-002-config-inventory.json`. Trace: `.smith-bench/run-yLEFui/home/.smith/runs/2026-05-16T20-06-58-859Z.trace`. No `git` or `.git` probe appeared, labels used `printf '%s\n'`, and the verifier passed on the first run.

Decision: stop this task because the representative failure classes are improved: no brittle printf label, no git/diff sandbox noise, no missing source heading verifier failure, and verifier success on the first attempt. Remaining overhead is general cautious inspection, not a clear failure.

## 2026-05-17: Incident Timeline Report and PTY Multiline Status

Command:

```sh
node bin/smith.js benchmark run benchmarks/003-incident-timeline --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Baseline result: passed in 19.8s, 8 turns, 12,113 tokens. Log: `/tmp/smith/2026-05-16T23-11-35-800Z-smith-003-incident-timeline.json`. Trace: `.smith-bench/run-7K67nd/home/.smith/runs/2026-05-16T23-11-16-447Z.trace`. Sandbox: `.smith-bench/run-7K67nd`.

Observed failure and inefficiency:

- Smith rewrote `root cause: missing index` as prose and needed a verifier failure to recover. Classification: prompt misunderstanding / verifier misuse.
- A later rerun still rewrote timestamp bullets into sentences and inspected `/task/verify.sh` after a silent verifier success was not surfaced from a multiline heredoc-plus-verifier command. Classification: shell/PTY issue, with secondary transcript formatting risk.

General improvements:

- Report guidance now says requested bullet-list reports should preserve original source bullet text verbatim instead of rewriting short bullets into prose.
- Benchmark task instructions now tell agents not to read `/task/verify.sh` before the first verifier run unless blocked or recovering from verifier failure.
- The PTY runner now wraps multiline commands in a single shell group so a prompt between pasted lines cannot end the turn before following commands run, and strips the wrapper echo from transcript output. Regression coverage checks silent success status for heredoc commands and nested verifier-style heredocs.

Rerun progression:

- After initial factual-fragment prompt guidance: passed in 48.5s, 9 turns, 14,126 tokens, but still failed once on rewritten timestamp/root-cause text. Log: `/tmp/smith/2026-05-16T23-13-24-745Z-smith-003-incident-timeline.json`. Trace: `.smith-bench/run-50LaaK/home/.smith/runs/2026-05-16T23-12-36-503Z.trace`.
- After stronger bullet guidance: passed in 30.2s, 9 turns, 17,022 tokens, with no verifier content failure, but inspected `/task/verify.sh` before running the verifier. Log: `/tmp/smith/2026-05-16T23-15-06-710Z-smith-003-incident-timeline.json`. Trace: `.smith-bench/run-w703tM/home/.smith/runs/2026-05-16T23-14-36-747Z.trace`.
- After verifier-read instruction: passed in 16.9s, 7 turns, 11,572 tokens, but exposed missing `exit_status` after a heredoc plus silent verifier success. Log: `/tmp/smith/2026-05-16T23-16-03-300Z-smith-003-incident-timeline.json`. Trace: `.smith-bench/run-iDkNC7/home/.smith/runs/2026-05-16T23-15-46-680Z.trace`.
- After PTY grouping/status fix and transcript cleanup: passed in 11.9s, 5 turns, 6,977 tokens. Log: `/tmp/smith/2026-05-16T23-23-19-722Z-smith-003-incident-timeline.json`. Trace: `.smith-bench/run-r4x40F/home/.smith/runs/2026-05-16T23-23-08-264Z.trace`. Sandbox: `.smith-bench/run-r4x40F`.

Decision: stop this task. The exact-report failure and the multiline PTY status issue are both improved, and the final run verifies directly after the focused edit without reading the verifier script.

## 2026-05-17: Manifest Checksum Shell Repair

Command:

```sh
node bin/smith.js benchmark run benchmarks/046-manifest-checksum --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Result: passed in 72.0s, 10 turns, 18,573 tokens. Log: `/tmp/smith/2026-05-16T23-25-25-814Z-smith-046-manifest-checksum.json`. Trace: `.smith-bench/run-S4LDrF/home/.smith/runs/2026-05-16T23-24-14-057Z.trace`. Sandbox: `.smith-bench/run-S4LDrF`.

Observed behavior and classification:

- Smith inspected the small workspace, made an overcomplicated first patch around locating `manifest.txt`, and the silent verifier failed. Classification: weak inspection / prompt misunderstanding.
- After the verifier failure, Smith inspected `/task/verify.sh`, learned the expected CLI shape, simplified the script to accept an optional filename argument and print only the checksum, then passed. Classification after recovery: verifier use was appropriate.

Decision: no Smith change from this task. The first patch was inefficient, but the evidence points to task reasoning rather than a clear reusable runner, prompt, transcript, or tool/schema defect. The new "do not read verifier before first run" instruction still behaved as intended: it avoided verifier overfitting up front while allowing verifier inspection after a concrete failure.

## 2026-05-17: CSV to JSON Report

Command:

```sh
node bin/smith.js benchmark run benchmarks/061-csv-to-json-report --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --timeout-ms 300000 --keep-sandbox --log-dir /tmp/smith --json
```

Result: passed in 10.5s, 6 turns, 8,192 tokens. Log: `/tmp/smith/2026-05-16T23-26-21-370Z-smith-061-csv-to-json-report.json`. Trace: `.smith-bench/run-s2wHnG/home/.smith/runs/2026-05-16T23-26-11-049Z.trace`. Sandbox: `.smith-bench/run-s2wHnG`.

Observed behavior and classification:

- Smith generated semantically correct pretty-printed JSON, but the verifier required exact compact formatting. It recovered immediately from the assertion diff by copying the expected format. Classification: verifier misuse / transcript formatting exactness.

Decision: no Smith change from this task. Existing guidance already tells Smith to preserve exact literals from verifier errors, and the recovery path was short. A broader prompt change to guess compact JSON before seeing verifier evidence would be speculative.

## 2026-05-17: SWE-bench Pro 001 NodeBB Email Validation

Command for each run:

```sh
node bin/smith.js benchmark run swe-bench-pro/001-nodebb-nodebb-vnan \
  --adapter chatgpt-codex \
  --base-url https://chatgpt.com/backend-api/codex \
  --model gpt-5.4-mini \
  --reasoning-effort high \
  --danger-review off \
  --max-turns 60 \
  --timeout-ms 900000 \
  --keep-sandbox \
  --log-dir /tmp/smith \
  --json
```

Baseline result: failed in 127.9s. Log: `/tmp/smith/2026-05-17T12-15-56-190Z-smith-001-nodebb-nodebb-vnan.json`. Trace: `.smith-bench/run-KiorMq/home/.smith/runs/2026-05-17T12-14-00-356Z.trace`. Sandbox: `.smith-bench/run-KiorMq`.

Classification:

- prompt misunderstanding
- premature chat_out
- context pollution
- SWE-bench Pro harness issue

Evidence summary: Smith inspected relevant NodeBB user email and database files, then answered its own exploratory terminal label about `src/user/email.js` line ranges as if it were the user request. It called `chat_out` without editing any source files. The post-run SWE-bench Pro verifier also failed before tests with Git's dubious ownership error for `/app`, so the harness could not distinguish code correctness.

Decision and Smith changes:

- Add global prompt guidance that command labels, comments, and exploratory questions printed in terminal output are workspace evidence, not user requests.
- Add a SWE-bench Pro verifier setup step to mark `/app` as a Git safe directory before setup commands and tests run.
- Add focused coverage in `tests/prompt-trace.test.ts` and `tests/benchmark.test.ts`.

Rerun result after those changes: failed in 607.7s. Log: `/tmp/smith/2026-05-17T12-27-51-779Z-smith-001-nodebb-nodebb-vnan.json`. Trace: `.smith-bench/run-gaSk3H/home/.smith/runs/2026-05-17T12-17-51-270Z.trace`. Sandbox: `.smith-bench/run-gaSk3H`.

Classification:

- prompt misunderstanding
- weak inspection
- context pollution
- verifier misuse

Evidence summary: The verifier reached the selected tests, confirming the safe-directory fix. Smith no longer answered its own line-range label, but drifted from the task's named implementation requirements into `public/language/*/admin/manage/users.json` localization changes. The verifier failed the expected source-code behavior: `db.mget is not a function` and `canSendValidation should return true if it has been long enough to re-send confirmation`.

Decision and Smith change: Add benchmark-task guidance that named implementation paths, functions, methods, and interfaces are primary source-code targets, and that docs, localization, fixtures, tests, build output, or generated files are not sufficient unless explicitly requested.

Rerun result after benchmark target guidance: failed in 439.2s with no `chat_out` within 60 turns. Log: `/tmp/smith/2026-05-17T12-36-16-751Z-smith-001-nodebb-nodebb-vnan.json`. Trace: `.smith-bench/run-0JkxIr/home/.smith/runs/2026-05-17T12-29-03-745Z.trace`. Sandbox: `.smith-bench/run-0JkxIr`.

Classification:

- no chat_out / turn-limit exhaustion
- weak inspection
- context pollution

Evidence summary: Smith did not edit tracked files. The trace showed broad recursive searches drifting through localization and generated language assets, consuming context without producing a patch.

Decision and Smith change: Add global prompt guidance to keep code-task searches scoped to likely source and test files, avoiding dependency, build, generated, and localization trees unless the task specifically involves them.

Rerun result after search-scope guidance: failed in 591.3s with no `chat_out` within 60 turns. Log: `/tmp/smith/2026-05-17T12-47-02-693Z-smith-001-nodebb-nodebb-vnan.json`. Trace: `.smith-bench/run-nEpDqu/home/.smith/runs/2026-05-17T12-37-18-369Z.trace`. Sandbox: `.smith-bench/run-nEpDqu`.

Classification:

- no chat_out / turn-limit exhaustion
- weak inspection
- bad patching
- patch command weakness

Evidence summary: The run avoided the previous broad localization drift and stayed around source/test files. It attempted a `smith_patch` against `src/user/email.js`, `src/api/users.js`, `src/user/profile.js`, `src/user/interstitials.js`, and `test/user/emails.js`, but the large patch failed with `hunk context not found in src/user/email.js`. The run then continued inspecting until the 60-turn limit without applying a successful tracked change.

Decision: stop this task. The run sequence produced clear general improvements to verifier setup, premature `chat_out` avoidance, benchmark target interpretation, and search scoping. The remaining task failure is a long-horizon implementation and patch-recovery problem on a large source change; another small, evidence-backed Smith change is less clear from this run alone.

Validation commands run for the Smith changes:

```sh
npm test -- tests/benchmark.test.ts tests/prompt-trace.test.ts
npm run build
```
