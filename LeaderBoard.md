# Leaderboard

Benchmark suites: `benchmarks/` (100 tasks) and `swe-bench-pro` (10 tasks).

Pricing uses standard API rates checked on 2026-05-17:
[`gpt-5.4-mini`](https://developers.openai.com/api/docs/models/gpt-5.4-mini) is `$0.75 / 1M` input, `$0.075 / 1M` cached input, and `$4.50 / 1M` output tokens; [`gpt-5.4`](https://developers.openai.com/api/docs/models/gpt-5.4/) is `$2.50 / 1M` input, `$0.25 / 1M` cached input, and `$15.00 / 1M` output tokens.

| Date | Dataset | Agent | Model | Reasoning | Passed | Failed | Score | Duration | Cost | Avg cost/task | Total tokens | Raw result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2026-05-17 | `benchmarks/` | Smith | `gpt-5.4-mini` | high | 100 | 0 | 100.0% | ~12m wall | `$2.264509` | `$0.022645` | 1,764,200 | `.smith-bench/smith-gpt-5.4-mini-high-project.json` |
| 2026-05-16 | `benchmarks/` | Codex CLI (`codex exec`) | `gpt-5.4-mini` | high | 61 | 39 | 61.0% | 1h 25m 52s | `$2.580855` | `$0.025809` | 17,082,782 | `.smith-bench/codex-gpt-5.4-mini-high.json` |

## Smith gpt-5.4-mini high, project benchmark

- Command: `node bin/smith.js benchmark run benchmarks --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --max-turns 60 --timeout-ms 900000 --concurrency 5 --log-dir /tmp/smith --input-cost-per-million-tokens 0.75 --cached-input-cost-per-million-tokens 0.075 --output-cost-per-million-tokens 4.5 --json`
- Concurrency: 5
- Wall time: approximately 12m; aggregate task duration: 52m 42s
- Input tokens: 1,513,171
- Cached input tokens: 0
- Output tokens: 251,029
- Reasoning output tokens: 0
- Estimated cost: `$2.26450875`
- Failed tasks: none

## Codex gpt-5.4-mini high

- Command: `node bin/smith.js benchmark run benchmarks --agent codex --model gpt-5.4-mini --reasoning-effort high --timeout-ms 300000 --json`
- Input tokens: 16,861,161
- Cached input tokens: 16,388,608
- Output tokens: 221,621
- Reasoning output tokens: 100,910
- Estimated cost: `$2.58085485`
- Failed tasks: `001-release-note-summary`, `002-config-inventory`, `003-incident-timeline`, `004-api-surface-report`, `005-dependency-policy-summary`, `006-migration-risk-notes`, `007-feature-flag-audit`, `008-log-pattern-report`, `037-timeout-test-stability`, `046-manifest-checksum`, `051-package-script-addition`, `055-editorconfig-tightening`, `058-docker-compose-healthcheck`, `059-app-settings-normalize`, `061-csv-to-json-report`, `062-dedupe-customers`, `063-aggregate-sales`, `065-merge-inventory`, `067-sort-release-notes`, `068-redact-sensitive-fields`, `081-cli-usage-doc`, `082-troubleshooting-entry`, `084-contributor-test-notes`, `085-changelog-backfill`, `086-architecture-decision-record`, `087-script-readme-sync`, `088-api-example-refresh`, `089-security-note-addition`, `090-migration-guide-step`, `091-command-router-refactor`, `092-plugin-registry-upgrade`, `093-cache-key-normalization`, `094-report-generator-hardening`, `095-task-runner-timeouts`, `096-workspace-audit-tool`, `097-release-planner-refactor`, `098-config-loader-validation`, `099-markdown-indexer`, `100-billing-rules-update`
