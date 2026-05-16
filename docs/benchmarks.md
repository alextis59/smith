# Benchmark Suite

Smith benchmark tasks live under `benchmarks/` and each task is a self-contained coding-agent exercise. The suite is intentionally local-only: tasks must not require internet access, secrets, package installs, privileged commands, external APIs, or nondeterministic timing.

## Directory Format

Each task directory must contain exactly the runner contract:

```text
Task.md
workspace/
verify.sh
```

- `Task.md` describes a realistic user request. It should explain the goal and constraints without disclosing verifier internals.
- `workspace/` contains the starting files Smith will inspect and edit inside Docker.
- `verify.sh` runs from the workspace root and must fail clearly when the final state is wrong. It should be executable, deterministic, and fast.

## Taxonomy

The 100-task suite is organized into ten groups:

| Range | Category | Focus |
| --- | --- | --- |
| 001-010 | Inspection and reporting | Read multiple files and produce concise reports |
| 011-020 | Single-file fixes | Focused JavaScript bug fixes with local tests |
| 021-030 | Multi-file changes | Entry points, helpers, exports, and CLI-like behavior |
| 031-040 | Test repair | Update stale tests or fixtures to match changed behavior |
| 041-050 | Shell scripts | Portable Bash fixes, quoting, strict mode, and file handling |
| 051-060 | Config editing | JSON, TOML, YAML, workflow, and editor config updates |
| 061-070 | Data transformation | Deterministic report generation from local data files |
| 071-080 | Edge cases | Boundary conditions in small utility functions |
| 081-090 | Documentation | Verified docs updates tied to concrete project behavior |
| 091-100 | Hard tasks | Multi-step refactors with implementation, tests, and docs |

## Running Benchmarks

Run one task:

```sh
smith benchmark run ./benchmarks/011-parse-port-default --profile fast
```

Run every task:

```sh
smith benchmark run ./benchmarks --profile fast
```

Use runner controls:

```sh
smith benchmark run ./benchmarks --timeout-ms 120000 --image node:22-bookworm
smith benchmark run ./benchmarks --json
smith benchmark run ./benchmarks/011-parse-port-default --keep-sandbox
smith benchmark validate ./benchmarks
```

The benchmark runner copies the task workspace into a Docker-backed sandbox, runs Smith in `node:22-bookworm`, then executes `verify.sh` in the sandboxed workspace. Tasks run in stable sorted order. Successful sandboxes are removed automatically; failed sandboxes are retained for inspection.

Projects can set a default benchmark profile:

```toml
[benchmark]
default_profile = "fast"
```

## Local Maintenance Checks

Regenerate the suite from the committed generator:

```sh
node scripts/generate-benchmarks.mjs
```

Validate task count, required files, executable verifiers, and solved-state verifier behavior:

```sh
node scripts/validate-benchmarks.mjs
```

Run a representative Docker-backed sample with a local fake provider after building the project:

```sh
npm run build
node scripts/run-benchmark-sample.mjs
```

Run every generated task through the same Docker-backed fake-provider path:

```sh
node scripts/run-benchmark-sample.mjs --all
```

The latest creation-time validation audit is recorded in [benchmark-validation-audit.md](benchmark-validation-audit.md).

Count task directories:

```sh
find benchmarks -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9]-*' | wc -l
```

## Adding Future Tasks

Add tasks by extending `scripts/generate-benchmarks.mjs`, regenerating the suite, and running `node scripts/validate-benchmarks.mjs`. New tasks should add meaningfully different work, not only new wording around an existing verifier pattern. Prefer local Node.js, shell, and plain text files already present in the workspace.

Good verifiers assert final behavior directly:

```sh
#!/usr/bin/env bash
set -euo pipefail
npm test
test "$(node -e 'import("./src/parse-port.js").then(m => console.log(m.parsePort("")))')" = "3000"
```

Avoid verifiers that depend on timing, network access, hidden provider state, or exact implementation text when behavior is what matters:

```sh
# Bad: nondeterministic and implementation-coupled.
sleep "$((RANDOM % 3))"
grep -q "function parsePort" src/parse-port.js
curl https://example.com/check
```

When adding or changing tasks, also run the relevant repository checks:

```sh
npm run build
npm test
npm run check
```
