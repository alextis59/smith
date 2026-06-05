# Auto Research Branch Diff Summary

Compared refs: `main...auto-research`

Merge base: `f62eaaa2f47f4edd8b6b711479626021d20e01b1`

Generated: 2026-05-31

## Benchmark Evidence

Full command:

```sh
node bin/smith.js benchmark run swe-bench-pro --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --max-turns 240 --timeout-ms 900000 --concurrency 5 --log-dir /tmp/smith --input-cost-per-million-tokens 0.75 --cached-input-cost-per-million-tokens 0.075 --output-cost-per-million-tokens 4.5 --json
```

Result: 5/10 passing tasks with Smith `gpt-5.4-mini` high.

Passed tasks: `002-qutebrowser`, `003-ansible`, `004-openlibrary`, `007-element-web`, `008-vuls`.

Failed tasks: `001-nodebb`, `005-teleport`, `006-navidrome`, `009-openlibrary`, `010-vuls`.

Timing and cost:

- Wall time: 30m 29s.
- Aggregate task duration: 2h 12m 41s.
- Tokens: 18,719,318 total; 18,067,002 input; 14,539,008 cached input; 652,316 output; 539,235 reasoning output.
- Estimated cost: `$6.671843`.
- Local raw result: `.smith-bench/smith-gpt-5.4-mini-high-swe-pro-2026-05-31-concurrency5.json`.
- Cleanup: retained `.smith-bench/run-*` sandboxes were pruned after the result was captured, reducing `.smith-bench` from 13G to 3.4M.

`LeaderBoard.md` records this run as the latest Smith `gpt-5.4-mini` high SWE-bench Pro result.

## Diff Size

`git diff --stat main...HEAD` reports 25 changed files, 26,565 insertions, and 432 deletions.

Most of the line count is detailed benchmark logging in:

- `docs/swe-bench-goal-summary.md`
- `docs/swe-bench-goal-worklog.md`
- `tests/integration.test.ts`

## Main Change Areas

### Benchmark Harness Integrity And Reliability

- Removed retained SWE-specific prompt coaching so SWE-bench tasks run with raw task prompts plus the normal generic Smith system behavior.
- Added protections around restored benchmark tests, including read-only handling, to reduce accidental benchmark-test edits during agent runs.
- Hid benchmark repository Git history from agent sandboxes where appropriate so agents solve from the working tree rather than mining commit history.
- Improved Docker and verifier handling with bash entrypoints, result artifact isolation, timeout headroom, and more explicit run logs.
- Added fallback tooling support such as an `rg` shim and host Node/toolchain preservation for task images that lack expected local utilities.

### Runtime Loop And Finish Guards

- Added generic progress and deadline reminders for long-running tasks.
- Added bounded post-deadline validation and inspection slots so agents can verify or explain blockers instead of timing out mid-check.
- Added guards for premature or contradictory finish claims, including no-op validation, dirty-test validation, incomplete requirements, and unsupported blocker claims.
- Improved tracking for explicit task requirements, pending validation files, test-file edits, declaration/signature compatibility risks, struct field changes, and local service blockers.
- Added sub-agent throttles, delegated turn budgets, failure preservation, and optional sub-agent disabling for reliability under long benchmark runs.

### Patch And Terminal Robustness

- Improved atomic patch failure guidance, read-only patch recovery, multi-document patch application, and stale patch reinspection.
- Redacted patch history in provider conversation state to control context growth while preserving useful failure signals.
- Isolated PTY exit and `errexit` commands to avoid poisoning later shell work.
- Reduced repeated timeout noise and highlighted failed command output more consistently.

### Provider, Config, Docs, And Tests

- Added provider-attempt timeout handling and ChatGPT Codex response-history adjustments.
- Updated configuration and provider docs for the new runtime options and benchmark behavior.
- Expanded tests across benchmark runner behavior, loop validation logic, patch handling, PTY behavior, provider configuration, and integration scenarios.

### Benchmark Logs And Operating Notes

- Added and maintained `docs/swe-bench-goal-summary.md` for concise milestone evidence.
- Added and maintained `docs/swe-bench-goal-worklog.md` for detailed hypotheses, failures, rejected ideas, and trace evidence.
- Recorded `.smith-bench` cleanup notes because retained benchmark sandboxes can grow to multiple GB.

## Policy Notes

The branch keeps the improvement scope generic:

- No hidden tests, gold patches, or external solution material were inspected.
- No scoring, result parsing, verifier logic, selected tests, task prompts, or run scripts were edited to inflate scores.
- SWE-specific prompt coaching that had been explored earlier was removed and replaced with generic runtime behavior.
- Remaining benchmark harness changes are aimed at faithful execution, artifact capture, timeout robustness, and sandbox integrity.

## Current Risk

The branch still records Smith `gpt-5.4-mini` high at 5/10 on the full SWE-bench Pro dataset, below the original 7/10 target. The broad loop and validation changes are covered by focused tests, but they affect agent control flow and should be watched for over-constraining normal interactive tasks.
