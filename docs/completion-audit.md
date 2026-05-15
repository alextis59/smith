# Smith v1 Completion Audit

Date: 2026-05-15

## Requirement Mapping

| Requirement | Implementation | Tests / validation |
| --- | --- | --- |
| Minimal terminal-first CLI coding agent | `src/cli.ts`, `src/loop.ts`, `src/pty.ts` | `tests/integration.test.ts`, `npm run check` |
| No model tools, MCP, skills, JSON schemas, or provider orchestration | Provider calls use plain text messages in `src/providers/*`; shell input is raw text in `src/loop.ts` | Adapter and integration tests verify text-only responses |
| Model outputs shell input into PTY | `PtyShellRunner` in `src/pty.ts` | `tests/pty.test.ts`, fake-provider integration |
| Visible `chat_out`, first `chat_out` ends single-shot and remote | helper generation in `src/pty.ts`, parser in `src/transcript.ts`, loop stop in `src/loop.ts` | `tests/transcript.test.ts`, `tests/pty.test.ts`, `tests/integration.test.ts` |
| `smith remote` stdout-only first `chat_out` | `src/remote.ts` | `tests/integration.test.ts` |
| Generated short-id remote resume | `src/remote-sessions.ts`, `src/remote.ts` | `tests/remote-sessions.test.ts`, `tests/integration.test.ts` |
| `smith_patch` terminal-native helper | `src/patch.ts`, `src/patch-cli.ts`, helper path in `src/pty.ts` | `tests/patch.test.ts` |
| Provider adapters: `openai-chat`, `openai-responses`, `gemini`, `anthropic-messages` | `src/providers/` | `tests/providers.test.ts` |
| Custom base URLs, headers, body extras, API key env vars | `src/config.ts`, `src/providers/types.ts` | `tests/config.test.ts`, `tests/providers.test.ts` |
| TOML config layering | `src/config.ts` | `tests/config.test.ts` |
| Normalized model options | `src/config.ts`, `src/providers/*` | `tests/providers.test.ts` |
| Separate reviewer profile | `src/config.ts`, `src/danger-review.ts`, loop/CLI/remote wiring | `tests/danger-review.test.ts` |
| Narrow dangerous-command review | `src/danger-review.ts` | `tests/danger-review.test.ts` |
| Packaged system prompt and additive `SMITH.md` | `prompts/system.txt`, `src/prompt.ts` | `tests/prompt-trace.test.ts` |
| Trace logging under `~/.smith/runs/` | `src/trace.ts`, loop/CLI/remote wiring | `tests/prompt-trace.test.ts`, integration tests with temp `HOME` |
| Docker benchmark runner | `src/benchmark/runner.ts`, CLI wiring in `src/cli.ts` | `tests/benchmark.test.ts` |
| Globally installable npm package with `smith` bin | `package.json`, `bin/smith.js` | final validation command: `npm install -g . && smith --help` |

## Commits

- `2697952` Add npm TypeScript CLI skeleton
- `e9454a3` Add TOML config loading
- `5a6e3f5` Add provider wire-format adapters
- `f8d202a` Add PTY runtime helpers
- `aef4eb1` Wire single-shot CLI agent loop
- `59de0de` Add remote mode with resumable sessions
- `cb3f85a` Add narrow LLM danger review
- `7d2905e` Add run traces and project prompts
- `f086e65` Add Docker benchmark runner
- `316755b` Clean up PTY shell on termination

## Validation Commands

Run during final validation:

```sh
npm run check
npm install -g .
smith --help
smith --version
```

Results on this machine:

- `npm run check`: 11 test files passed, 32 tests passed.
- Docker benchmark validation: included in `npm run check`; Docker was available and the minimal passing task test ran successfully.
- `npm install -g .`: succeeded and installed one local package.
- `smith --help`: succeeded and printed CLI usage.
- `smith --version`: succeeded and printed `0.1.0`.

## Known Constraints

- The npm package name `smith` is already occupied in the public registry. Local global install works and publishing was not attempted.
- Remote resume persists transcript context and restarts a fresh shell. It does not checkpoint a live shell process.
- Parent termination cleanup is implemented by killing the PTY shell on `SIGINT` and `SIGTERM`; foreground child commands owned by that PTY are cleaned up where the OS terminal semantics allow.
