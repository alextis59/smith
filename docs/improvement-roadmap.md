# Smith Improvement Roadmap

This document lists practical improvements for Smith after the initial terminal-first CLI, provider adapters, remote mode, traces, danger review, and benchmark suite.

## Benchmark Runner

- Clean up benchmark sandboxes automatically after successful runs, with a `--keep-sandbox` option for debugging.
- Add `--timeout-ms`, `--image`, and `--json` CLI flags for `smith benchmark run`; the runner supports some options internally that are not yet all exposed through the CLI.
- Add benchmark summary output: total passed, total failed, total duration, and failed task list.
- Run benchmark tasks in stable sorted order explicitly.
- Add a `smith benchmark validate` command for task structure checks.

## Agent Runtime

- Improve PTY lifecycle cleanup for foreground child processes and Docker-created files.
- Add clearer timeout reporting: command running, elapsed time, and last terminal output.
- Add retry or recovery handling for transient provider failures.
- Support configurable transcript compaction once runs get long.
- Add a hard cap for repeated model turns to prevent runaway loops.

## CLI UX

- Add `--quiet` for normal non-remote runs.
- Add `--json` output mode for automation.
- Improve error messages for config and profile resolution failures.
- Add `smith config doctor` to explain loaded config files, active profile, missing API keys, and runtime settings.
- Add concise examples to `smith --help`.

## Configuration

- Validate config values more strictly: numeric ranges, unknown runtime modes, bad URLs, and invalid profile settings.
- Add a command to inspect the merged config after all layers are applied.
- Support a per-project default benchmark profile.
- Consider environment-variable overrides for common runtime options.

## Safety

- Expand danger-review test coverage for borderline shell patterns.
- Add a local deterministic danger-review mode for common blocked commands, independent of LLM review.
- Document exactly what danger review does and does not protect against.
- Add optional read-only mode for inspection-only tasks.

## Provider Adapters

- Improve provider error normalization so users see actionable messages.
- Add tests for malformed provider responses.
- Support response usage reporting consistently where providers expose it.
- Add adapter-level request logging behind an explicit debug flag.

## Remote Mode

- Add `smith remote list`, `smith remote show`, and `smith remote delete` session commands.
- Store richer session metadata: cwd, profile, created time, last prompt, and trace path.
- Add expiration or cleanup for old remote sessions.
- Make resume errors more explanatory when session files are missing or corrupt.

## Docs

- Add a short architecture page explaining the terminal-first runtime model.
- Add config examples for OpenAI, Gemini, Anthropic, OpenRouter, and local gateways.
- Add a troubleshooting page for PTY, Docker, API keys, and benchmark failures.
- Add benchmark authoring examples with good and bad verifier patterns.
