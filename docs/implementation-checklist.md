# Smith v1 Implementation Checklist

Source of truth: `docs/smith-implementation-study.md`.

## Repository and Package Notes

- Current branch: `main`.
- Remote: `origin` at `git@github.com:alextis59/smith.git`.
- The branch currently tracks `origin/main`.
- The npm package name `smith` is already published by another package. This repo can still expose a global `smith` binary through local installation, but publishing under the `smith` package name is blocked unless ownership changes. Do not publish without explicit instruction.

## Milestones

1. npm/TypeScript CLI skeleton, package metadata, bin wiring, and basic tests.
2. TOML config system, profile resolution, environment secret lookup, and precedence tests.
3. Provider adapter layer for `openai-chat`, `openai-responses`, `gemini`, and `anthropic-messages`, including fake-provider tests.
4. PTY shell runner, transcript loop, provider `run`/`patch`/`sub_agent`/`finish` tools, and legacy `chat_out` compatibility.
5. Terminal-native `smith_patch` helper behind the `patch` tool and focused tests.
6. Interactive and single-shot CLI flows.
7. `smith remote`, stdout/stderr separation, child cleanup, and short-id remote resume persistence.
8. Narrow dangerous-command review using a separate reviewer profile.
9. Trace logging, context limits, packaged prompt loading, and additive `SMITH.md`.
10. Docker-backed benchmark runner with task folders.
11. README/user docs, examples, local global-install validation, and final completion audit.

## Required Validation

- Unit tests for config precedence, adapter request/response mapping, provider tool calls, transcript handling, fenced-shell stripping, `chat_out` compatibility parsing, `smith_patch`, danger review, and remote resume state.
- Integration tests with a fake HTTP provider that returns tool calls.
- Fake-provider end-to-end run in a temporary repo.
- `smith remote` prints only the child `finish` message to stdout.
- Parent termination cleans child Smith processes where feasible.
- Docker benchmark runner works with a minimal passing task.
- Local global install works with `npm install -g .` and exposes a working `smith` binary.

## Commit Discipline

After each significant milestone:

- Run the relevant tests/checks.
- Update docs when behavior changes.
- Inspect `git diff`.
- Commit with a scoped message.
- Push the branch without force pushing.
