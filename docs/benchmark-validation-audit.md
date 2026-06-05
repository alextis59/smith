# Benchmark Validation Audit

Date: 2026-05-16

## Scope

This audit covers the initial 100-task Smith benchmark suite under `benchmarks/`. The suite contains exactly 100 task directories, numbered `001` through `100`, and each task has:

- `Task.md`
- `workspace/`
- executable `verify.sh`

## Validation Commands

Run during suite creation:

```sh
node --check scripts/generate-benchmarks.mjs
node --check scripts/validate-benchmarks.mjs
node --check scripts/run-benchmark-sample.mjs
node scripts/generate-benchmarks.mjs
find benchmarks -mindepth 1 -maxdepth 1 -type d -name '[0-9][0-9][0-9]-*' | wc -l
find benchmarks -mindepth 2 -maxdepth 2 -type f -name Task.md | wc -l
find benchmarks -mindepth 2 -maxdepth 2 -type d -name workspace | wc -l
find benchmarks -mindepth 2 -maxdepth 2 -type f -name verify.sh -perm -111 | wc -l
node scripts/validate-benchmarks.mjs
npm run build
npm test
npm run check
node scripts/run-benchmark-sample.mjs
node scripts/run-benchmark-sample.mjs --all
```

Results:

- Task directory count: `100`.
- `Task.md` count: `100`.
- `workspace/` count: `100`.
- executable `verify.sh` count: `100`.
- `node scripts/validate-benchmarks.mjs`: passed for all 100 solved-state verifiers.
- `npm run build`: passed.
- `npm test`: 11 test files passed, 32 tests passed.
- `npm run check`: passed.
- `node scripts/run-benchmark-sample.mjs`: 8 representative Docker-backed tasks passed.
- `node scripts/run-benchmark-sample.mjs --all`: all 100 Docker-backed tasks passed.

## Benchmark Runner Note

The Docker benchmark runner normally evaluates Smith with a configured model provider. To keep validation deterministic and avoid external APIs, secrets, or internet access, `scripts/run-benchmark-sample.mjs` starts a local OpenAI-compatible fake provider and injects temporary task-local Smith config into copied task workspaces. This exercises the existing Docker benchmark runner path, workspace copying, Smith execution, and each task verifier without depending on a live model.

## 101-Task Update

Date: 2026-05-23

Task `101-workflow-policy-engine` extends the hard-task group with a larger cross-file workflow-policy exercise intended to produce richer traces for patch and sub-agent behavior. The validation script now derives the expected task count from `scripts/generate-benchmarks.mjs`.

Validation commands:

```sh
node --check scripts/generate-benchmarks.mjs
node --check scripts/validate-benchmarks.mjs
node --check scripts/run-benchmark-sample.mjs
node scripts/generate-benchmarks.mjs
node scripts/validate-benchmarks.mjs
npm run build
node scripts/run-benchmark-sample.mjs
npm test -- tests/benchmark.test.ts
```

Results:

- `node scripts/validate-benchmarks.mjs`: passed for all 101 solved-state verifiers.
- `node scripts/run-benchmark-sample.mjs`: 9 representative Docker-backed tasks passed, including `101-workflow-policy-engine`.
- `npm test -- tests/benchmark.test.ts`: 13 tests passed.

## Milestone Commits

- `7c61381` Add benchmark taxonomy and generator scaffolding
- `76dd9ff` Add first benchmark task batch
- `19cc273` Add second benchmark task batch
- `9b44427` Add third benchmark task batch
- `c6a4282` Add final benchmark task batch
