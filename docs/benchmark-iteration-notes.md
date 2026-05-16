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
