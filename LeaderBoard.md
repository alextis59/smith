# Leaderboard

Benchmark suites: `benchmarks/` (100 tasks) and `swe-bench-pro` (10 tasks).

Pricing uses standard API rates checked on 2026-05-17:
[`gpt-5.4-mini`](https://developers.openai.com/api/docs/models/gpt-5.4-mini) is `$0.75 / 1M` input, `$0.075 / 1M` cached input, and `$4.50 / 1M` output tokens; [`gpt-5.4`](https://developers.openai.com/api/docs/models/gpt-5.4/) is `$2.50 / 1M` input, `$0.25 / 1M` cached input, and `$15.00 / 1M` output tokens.

| Date | Dataset | Agent | Model | Reasoning | Passed | Failed | Score | Duration | Cost | Avg cost/task | Total tokens | Raw result |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2026-05-20 | `benchmarks/` | Smith | `gpt-5.4-mini` | high | 100 | 0 | 100.0% | 6m 14s wall | `$1.629856` | `$0.016299` | 3,457,851 | `.smith-bench/smith-gpt-5.4-mini-high-project-2026-05-20.json` |
| 2026-05-20 | `swe-bench-pro` | Smith | `gpt-5.4-mini` | high | 3 | 7 | 30.0% | 28m 28s wall | `$6.647671` | `$0.664767` | 26,039,697 | `.smith-bench/smith-gpt-5.4-mini-high-swe-pro-2026-05-20.json` |
| 2026-05-20 | `swe-bench-pro` | Codex CLI (`codex exec`) | `gpt-5.4-mini` | high | 4 | 6 | 40.0% | 20m 43s wall | `$2.533078` | `$0.253308` | 16,365,466 | `.smith-bench/codex-gpt-5.4-mini-high-swe-pro-2026-05-20.json` |
| 2026-05-19 | `benchmarks/` | Smith | `gpt-5.4-mini` | high | 100 | 0 | 100.0% | ~5m 58s wall | `$2.075478` | `$0.020755` | 2,032,162 | `.smith-bench/smith-gpt-5.4-mini-high-project-compacted-split.json` |
| 2026-05-18 | `benchmarks/` | Smith | `gpt-5.4-mini` | high | 100 | 0 | 100.0% | 5m 49s wall | `$1.971961` | `$0.019720` | 1,927,941 | `.smith-bench/smith-gpt-5.4-mini-high-project.json` |
| 2026-05-17 | `swe-bench-pro` | Codex CLI (`codex exec`) | `gpt-5.4` | high | 7 | 3 | 70.0% | 11m 49s wall | `$6.523216` | `$0.652322` | 13,913,681 | `.smith-bench/codex-gpt-5.4-high-swe-pro.json` |
| 2026-05-17 | `swe-bench-pro` | Codex CLI (`codex exec`) | `gpt-5.4-mini` | high | 5 | 5 | 50.0% | 16m 42s wall | `$4.248726` | `$0.424873` | 33,755,588 | `.smith-bench/codex-gpt-5.4-mini-high-swe-pro.json` |
| 2026-05-17 | `swe-bench-pro` | Smith | `gpt-5.4` | high | 3 | 7 | 30.0% | 30m 41s wall | `$2.729475` | `$0.272948` | 885,540 | `.smith-bench/smith-gpt-5.4-high-swe-pro.json` |
| 2026-05-18 | `swe-bench-pro` | Smith | `gpt-5.4-mini` | high | 3 | 7 | 30.0% | 1h 32m 24s wall | `$2.928527` | `$0.292853` | 3,590,370 | `.smith-bench/smith-gpt-5.4-mini-high-swe-pro.json` |
| 2026-05-16 | `benchmarks/` | Codex CLI (`codex exec`) | `gpt-5.4-mini` | high | 61 | 39 | 61.0% | 1h 25m 52s | `$2.580855` | `$0.025809` | 17,082,782 | `.smith-bench/codex-gpt-5.4-mini-high.json` |

## Smith gpt-5.4-mini high, project benchmark

- Current command: `node bin/smith.js benchmark run benchmarks --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --max-turns 60 --timeout-ms 900000 --concurrency 10 --log-dir /tmp/smith --input-cost-per-million-tokens 0.75 --cached-input-cost-per-million-tokens 0.075 --output-cost-per-million-tokens 4.5 --prompt-cache-key auto --json`
- Concurrency: 10
- 2026-05-20 provider message-chain + prompt-cache-key rerun: 6m 14s wall; aggregate task duration: 50m 13s
- Input tokens: 3,228,142
- Cached input tokens: 2,703,616
- Cached input share: 83.8%
- Output tokens: 229,709
- Reasoning output tokens: 160,239
- Estimated cost: `$1.62985620`
- Failed tasks: none
- Raw result: `.smith-bench/smith-gpt-5.4-mini-high-project-2026-05-20.json`
- 2026-05-19 compaction-only split rerun: ~5m 58s wall; aggregate task duration: 51m 28s
- Input tokens: 1,747,723
- Cached input tokens: 763,392
- Output tokens: 284,439
- Reasoning output tokens: 222,409
- Estimated cost: `$2.07547815`
- Failed tasks: none
- Raw result: `.smith-bench/smith-gpt-5.4-mini-high-project-compacted-split.json`
- 2026-05-18 baseline:
- Wall time: 5m 49s; aggregate task duration: 51m 2s
- Input tokens: 1,652,382
- Cached input tokens: 751,616
- Output tokens: 275,559
- Reasoning output tokens: 215,894
- Estimated cost: `$1.9719612`
- Failed tasks: none

## Codex gpt-5.4-mini high, SWE-bench Pro

- Command: `node bin/smith.js benchmark run swe-bench-pro --agent codex --model gpt-5.4-mini --reasoning-effort high --timeout-ms 900000 --concurrency 5 --log-dir /tmp/smith --input-cost-per-million-tokens 0.75 --cached-input-cost-per-million-tokens 0.075 --output-cost-per-million-tokens 4.5 --json`
- Concurrency: 5
- 2026-05-20 rerun: 20m 43s wall; aggregate task duration: 1h 7m 0s
- Input tokens: 16,179,425
- Cached input tokens: 15,464,704
- Cached input share: 95.6%
- Output tokens: 186,041
- Reasoning output tokens: 119,268
- Estimated cost: `$2.53307805`
- Usage note: task `005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037` did not include parsed token usage in the runner result, so aggregate usage and cost reflect reported usage only.
- Passed tasks: `002-qutebrowser-qutebrowser-v059c6fdc75567943479b23ebca7c07b5e9a7f34c`, `004-internetarchive-openlibrary-v13642507b4fc1f8d234172bf8129942da2c2ca26`, `007-element-hq-element-web-33e8edb3d508d6eefb354819ca693b7accc695e7`, `008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904`
- Failed tasks: `001-nodebb-nodebb-vnan`, `003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, `005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037`, `006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, `009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59`, `010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`
- Raw result: `.smith-bench/codex-gpt-5.4-mini-high-swe-pro-2026-05-20.json`
- 2026-05-17 baseline:
- Wall time: 16m 42s; aggregate task duration: 1h 4m 45s
- Input tokens: 33,497,383
- Cached input tokens: 32,646,272
- Output tokens: 258,205
- Reasoning output tokens: 167,672
- Estimated cost: `$4.24872615`
- Failed tasks: `001-nodebb-nodebb-vnan`, `003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, `005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037`, `006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, `009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59`

## Smith gpt-5.4-mini high, SWE-bench Pro

- Current command: `node bin/smith.js benchmark run swe-bench-pro --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4-mini --reasoning-effort high --danger-review off --max-turns 160 --timeout-ms 900000 --concurrency 5 --log-dir /tmp/smith --input-cost-per-million-tokens 0.75 --cached-input-cost-per-million-tokens 0.075 --output-cost-per-million-tokens 4.5 --prompt-cache-key auto --json`
- Concurrency: 5
- Max turns: 160
- 2026-05-20 provider message-chain + prompt-cache-key rerun: 28m 28s wall; aggregate task duration: 1h 42m 10s
- Input tokens: 25,494,626
- Cached input tokens: 22,112,768
- Cached input share: 86.7%
- Output tokens: 545,071
- Reasoning output tokens: 446,993
- Estimated cost: `$6.64767060`
- Passed tasks: `002-qutebrowser-qutebrowser-v059c6fdc75567943479b23ebca7c07b5e9a7f34c`, `004-internetarchive-openlibrary-v13642507b4fc1f8d234172bf8129942da2c2ca26`, `007-element-hq-element-web-33e8edb3d508d6eefb354819ca693b7accc695e7`
- Failed tasks: `001-nodebb-nodebb-vnan`, `003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, `005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037`, `006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, `008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904`, `009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59`, `010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`
- Raw result: `.smith-bench/smith-gpt-5.4-mini-high-swe-pro-2026-05-20.json`
- 2026-05-18 baseline:
- Wall time: 1h 32m 24s; aggregate task duration: 5h 25m 11s
- Input tokens: 3,418,985
- Cached input tokens: 602,880
- Output tokens: 171,385
- Reasoning output tokens: 148,479
- Estimated cost: `$2.92852725`
- Passed tasks: `002-qutebrowser-qutebrowser-v059c6fdc75567943479b23ebca7c07b5e9a7f34c`, `004-internetarchive-openlibrary-v13642507b4fc1f8d234172bf8129942da2c2ca26`, `007-element-hq-element-web-33e8edb3d508d6eefb354819ca693b7accc695e7`
- Failed tasks: `001-nodebb-nodebb-vnan`, `003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, `005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037`, `006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, `008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904`, `009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59`, `010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`

## Codex gpt-5.4 high, SWE-bench Pro

- Command: `node bin/smith.js benchmark run swe-bench-pro --agent codex --model gpt-5.4 --reasoning-effort high --timeout-ms 900000 --concurrency 5 --log-dir /tmp/smith --input-cost-per-million-tokens 2.5 --cached-input-cost-per-million-tokens 0.25 --output-cost-per-million-tokens 15 --json`
- Concurrency: 5
- Wall time: 11m 49s; aggregate task duration: 44m 6s
- Input tokens: 13,806,670
- Cached input tokens: 13,154,944
- Output tokens: 107,011
- Reasoning output tokens: 37,401
- Estimated cost: `$6.523216`
- Failed tasks: `003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, `006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, `009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59`

## Smith gpt-5.4 high, SWE-bench Pro

- Command: `node bin/smith.js benchmark run swe-bench-pro --adapter chatgpt-codex --base-url https://chatgpt.com/backend-api/codex --model gpt-5.4 --reasoning-effort high --danger-review off --max-turns 60 --timeout-ms 900000 --concurrency 5 --log-dir /tmp/smith --input-cost-per-million-tokens 2.5 --cached-input-cost-per-million-tokens 0.25 --output-cost-per-million-tokens 15 --json`
- Concurrency: 5
- Wall time: 30m 41s; aggregate task duration: 1h 55m 9s
- Input tokens: 844,290
- Cached input tokens: 0
- Output tokens: 41,250
- Reasoning output tokens: 0
- Estimated cost: `$2.729475`
- Failed tasks: `001-nodebb-nodebb-vnan`, `003-ansible-ansible-vba6da65a0f3baefda7a058ebbd0a8dcafb8512f5`, `005-gravitational-teleport-v626ec2a48416b10a88641359a169d99e935ff037`, `006-navidrome-navidrome-7073d18b54da7e53274d11c9e2baef1242e8769e`, `008-future-architect-vuls-407407d306e9431d6aa0ab566baa6e44e5ba2904`, `009-internetarchive-openlibrary-v2d9a6c849c60ed19fd0858ce9e40b7cc8e097e59`, `010-future-architect-vuls-e6c0da61324a0c04026ffd1c031436ee2be9503a`

## Codex gpt-5.4-mini high

- Command: `node bin/smith.js benchmark run benchmarks --agent codex --model gpt-5.4-mini --reasoning-effort high --timeout-ms 300000 --json`
- Input tokens: 16,861,161
- Cached input tokens: 16,388,608
- Output tokens: 221,621
- Reasoning output tokens: 100,910
- Estimated cost: `$2.58085485`
- Failed tasks: `001-release-note-summary`, `002-config-inventory`, `003-incident-timeline`, `004-api-surface-report`, `005-dependency-policy-summary`, `006-migration-risk-notes`, `007-feature-flag-audit`, `008-log-pattern-report`, `037-timeout-test-stability`, `046-manifest-checksum`, `051-package-script-addition`, `055-editorconfig-tightening`, `058-docker-compose-healthcheck`, `059-app-settings-normalize`, `061-csv-to-json-report`, `062-dedupe-customers`, `063-aggregate-sales`, `065-merge-inventory`, `067-sort-release-notes`, `068-redact-sensitive-fields`, `081-cli-usage-doc`, `082-troubleshooting-entry`, `084-contributor-test-notes`, `085-changelog-backfill`, `086-architecture-decision-record`, `087-script-readme-sync`, `088-api-example-refresh`, `089-security-note-addition`, `090-migration-guide-step`, `091-command-router-refactor`, `092-plugin-registry-upgrade`, `093-cache-key-normalization`, `094-report-generator-hardening`, `095-task-runner-timeouts`, `096-workspace-audit-tool`, `097-release-planner-refactor`, `098-config-loader-validation`, `099-markdown-indexer`, `100-billing-rules-update`
