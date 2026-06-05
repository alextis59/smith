#!/usr/bin/env node
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmarksRoot = join(repoRoot, "benchmarks");

const families = [
  {
    key: "inspect",
    title: "Inspection and Reporting",
    tags: ["inspection", "reporting", "docs"],
    count: 10,
    names: [
      "release-note-summary",
      "config-inventory",
      "incident-timeline",
      "api-surface-report",
      "dependency-policy-summary",
      "migration-risk-notes",
      "feature-flag-audit",
      "log-pattern-report",
      "schema-field-inventory",
      "docs-gap-summary"
    ]
  },
  {
    key: "single",
    title: "Single-file JavaScript Fix",
    tags: ["javascript", "single-file", "bug-fix"],
    count: 10,
    names: [
      "parse-port-default",
      "slugify-edge-cases",
      "duration-formatting",
      "csv-line-splitter",
      "invoice-rounding",
      "env-bool-parser",
      "unique-id-normalizer",
      "date-window-filter",
      "retry-delay-cap",
      "markdown-heading-anchor"
    ]
  },
  {
    key: "multi",
    title: "Multi-file Application Change",
    tags: ["multi-file", "javascript", "cli"],
    count: 10,
    names: [
      "json-output-mode",
      "shared-version-banner",
      "config-default-layering",
      "error-code-export",
      "command-alias-support",
      "quiet-mode-plumbing",
      "template-partial-rename",
      "metrics-label-normalization",
      "repository-root-helper",
      "feature-toggle-wiring"
    ]
  },
  {
    key: "tests",
    title: "Test Repair",
    tags: ["tests", "fixtures", "regression"],
    count: 10,
    names: [
      "snapshot-date-update",
      "fixture-path-repair",
      "renamed-status-test",
      "cli-help-expectation",
      "golden-json-order",
      "locale-number-test",
      "timeout-test-stability",
      "schema-version-fixture",
      "mock-response-shape",
      "legacy-name-removal"
    ]
  },
  {
    key: "shell",
    title: "Shell Script Repair",
    tags: ["shell", "scripts", "portable"],
    count: 10,
    names: [
      "safe-clean-script",
      "quoted-path-backup",
      "numeric-sort-report",
      "strict-env-check",
      "argument-forwarding",
      "manifest-checksum",
      "log-rollup-script",
      "release-tag-validator",
      "parallel-safe-tempdir",
      "newline-preserving-filter"
    ]
  },
  {
    key: "config",
    title: "Config Editing",
    tags: ["json", "toml", "yaml", "config"],
    count: 10,
    names: [
      "package-script-addition",
      "toml-profile-update",
      "yaml-service-port",
      "json-schema-required",
      "editorconfig-tightening",
      "ci-matrix-extension",
      "eslint-ignore-cleanup",
      "docker-compose-healthcheck",
      "app-settings-normalize",
      "release-manifest-channel"
    ]
  },
  {
    key: "data",
    title: "Data Transformation",
    tags: ["data", "node", "transformation"],
    count: 10,
    names: [
      "csv-to-json-report",
      "dedupe-customers",
      "aggregate-sales",
      "normalize-tags",
      "merge-inventory",
      "split-ledger",
      "sort-release-notes",
      "redact-sensitive-fields",
      "derive-sla-buckets",
      "convert-table-to-markdown"
    ]
  },
  {
    key: "edge",
    title: "Edge-case Handling",
    tags: ["edge-cases", "javascript", "robustness"],
    count: 10,
    names: [
      "empty-input-statistics",
      "unicode-trim",
      "negative-zero-format",
      "nested-missing-key",
      "query-param-array",
      "path-extension-hidden-file",
      "range-overlap-boundary",
      "json-lines-final-newline",
      "markdown-table-pipes",
      "semver-prerelease-sort"
    ]
  },
  {
    key: "docs",
    title: "Documentation Update with Verification",
    tags: ["documentation", "verification", "multi-file"],
    count: 10,
    names: [
      "cli-usage-doc",
      "troubleshooting-entry",
      "config-reference-sync",
      "contributor-test-notes",
      "changelog-backfill",
      "architecture-decision-record",
      "script-readme-sync",
      "api-example-refresh",
      "security-note-addition",
      "migration-guide-step"
    ]
  },
  {
    key: "hard",
    title: "Coherent Multi-step Task",
    tags: ["hard", "multi-step", "refactor"],
    count: 11,
    names: [
      "command-router-refactor",
      "plugin-registry-upgrade",
      "cache-key-normalization",
      "report-generator-hardening",
      "task-runner-timeouts",
      "workspace-audit-tool",
      "release-planner-refactor",
      "config-loader-validation",
      "markdown-indexer",
      "billing-rules-update",
      "workflow-policy-engine"
    ]
  }
];

function taskSpecs() {
  const specs = [];
  let id = 1;
  for (const family of families) {
    for (let index = 0; index < family.count; index += 1) {
      const name = family.names[index];
      specs.push(makeSpec(id, family, index, name));
      id += 1;
    }
  }
  return specs;
}

function makeSpec(id, family, index, name) {
  const slug = `${String(id).padStart(3, "0")}-${name}`;
  const base = {
    id,
    slug,
    family: family.key,
    title: `${family.title}: ${toTitle(name)}`,
    difficulty: family.key === "hard" ? "hard" : id % 3 === 0 ? "medium" : "easy",
    tags: family.tags
  };

  if (family.key === "inspect") return inspectSpec(base, index);
  if (family.key === "single") return singleSpec(base, index);
  if (family.key === "multi") return multiSpec(base, index);
  if (family.key === "tests") return testsSpec(base, index);
  if (family.key === "shell") return shellSpec(base, index);
  if (family.key === "config") return configSpec(base, index);
  if (family.key === "data") return dataSpec(base, index);
  if (family.key === "edge") return edgeSpec(base, index);
  if (family.key === "docs") return docsSpec(base, index);
  return hardSpec(base, index);
}

function inspectSpec(base, index) {
  const topics = [
    ["Release 2.4", "payments retry fix", "mobile receipt copy", "rollback flag receipt_v2"],
    ["Runtime Config", "SMITH_PROFILE", "runtime.timeout_ms", "danger_review"],
    ["Incident 1187", "09:14 queue depth warning", "09:22 worker restart", "root cause: missing index"],
    ["Public API", "createSession", "resumeSession", "listSessions"],
    ["Dependency Policy", "no runtime SDK lock-in", "Node 22 baseline", "no network during tests"],
    ["Migration", "rename `agent` to `smith`", "keep remote resume ids", "update package bin"],
    ["Flags", "beta_search disabled", "receipt_v2 enabled", "legacy_import remove"],
    ["Logs", "WARN backpressure", "ERROR provider timeout", "INFO retry succeeded"],
    ["Schema", "customer_id", "invoice_total", "issued_at", "line_items"],
    ["Docs Gap", "benchmark runner options", "danger review modes", "remote resume example"]
  ][index];
  const reportName = index % 2 === 0 ? "summary.md" : "audit.md";
  const files = {
    "README.md": `# ${topics[0]}\n\nReview these notes and produce the requested report.\n`,
    "notes/source-a.md": `Primary note:\n- ${topics[1]}\n- ${topics[2]}\n`,
    "notes/source-b.md": `Secondary note:\n- ${topics[3]}\n${topics[4] ? `- ${topics[4]}\n` : ""}`
  };
  const expected = `# ${topics[0]} Report\n\n- ${topics[1]}\n- ${topics[2]}\n- ${topics[3]}\n${topics[4] ? `- ${topics[4]}\n` : ""}`;
  return {
    ...base,
    prompt: `Inspect the project notes and write ${reportName}. Include the important concrete facts a maintainer would need, with a short heading and bullet list. Do not modify the source notes.`,
    files,
    solution: { [reportName]: expected },
    verify: verifierIncludes(reportName, [topics[0], topics[1], topics[2], topics[3]].concat(topics[4] ? [topics[4]] : []), ["notes/source-a.md", "notes/source-b.md"])
  };
}

function singleSpec(base, index) {
  const cases = [
    {
      file: "src/parse-port.js",
      initial: `export function parsePort(value) {\n  return Number(value) || 3000;\n}\n`,
      solution: `export function parsePort(value) {\n  if (value === undefined || value === null || value === "") return 3000;\n  const port = Number(value);\n  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("invalid port");\n  return port;\n}\n`,
      tests: `import { parsePort } from "./src/parse-port.js";\nimport assert from "node:assert/strict";\nassert.equal(parsePort(undefined), 3000);\nassert.equal(parsePort("0"), 0);\nassert.equal(parsePort("8080"), 8080);\nassert.throws(() => parsePort("abc"), /invalid port/);\nassert.throws(() => parsePort("70000"), /invalid port/);\n`
    },
    {
      file: "src/slugify.js",
      initial: `export function slugify(input) {\n  return input.toLowerCase().replaceAll(" ", "-");\n}\n`,
      solution: `export function slugify(input) {\n  return String(input)\n    .trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-|-$/g, "");\n}\n`,
      tests: `import { slugify } from "./src/slugify.js";\nimport assert from "node:assert/strict";\nassert.equal(slugify(" Hello, Smith! "), "hello-smith");\nassert.equal(slugify("Two   Spaces"), "two-spaces");\nassert.equal(slugify("v2.4 release"), "v2-4-release");\n`
    },
    {
      file: "src/format-duration.js",
      initial: `export function formatDuration(ms) {\n  return Math.round(ms / 1000) + "s";\n}\n`,
      solution: `export function formatDuration(ms) {\n  if (ms < 1000) return String(ms) + "ms";\n  const seconds = Math.floor(ms / 1000);\n  const minutes = Math.floor(seconds / 60);\n  const rest = seconds % 60;\n  return minutes > 0 ? String(minutes) + "m " + String(rest) + "s" : String(seconds) + "s";\n}\n`,
      tests: `import { formatDuration } from "./src/format-duration.js";\nimport assert from "node:assert/strict";\nassert.equal(formatDuration(250), "250ms");\nassert.equal(formatDuration(1500), "1s");\nassert.equal(formatDuration(65000), "1m 5s");\n`
    },
    {
      file: "src/split-csv-line.js",
      initial: `export function splitCsvLine(line) {\n  return line.split(",");\n}\n`,
      solution: `export function splitCsvLine(line) {\n  const cells = [];\n  let cell = "";\n  let quoted = false;\n  for (let i = 0; i < line.length; i += 1) {\n    const char = line[i];\n    if (char === '"') {\n      quoted = !quoted;\n    } else if (char === "," && !quoted) {\n      cells.push(cell);\n      cell = "";\n    } else {\n      cell += char;\n    }\n  }\n  cells.push(cell);\n  return cells;\n}\n`,
      tests: `import { splitCsvLine } from "./src/split-csv-line.js";\nimport assert from "node:assert/strict";\nassert.deepEqual(splitCsvLine("a,b,c"), ["a", "b", "c"]);\nassert.deepEqual(splitCsvLine("a,\\"b,c\\",d"), ["a", "b,c", "d"]);\n`
    },
    {
      file: "src/invoice-total.js",
      initial: `export function invoiceTotal(lines) {\n  return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);\n}\n`,
      solution: `export function invoiceTotal(lines) {\n  const cents = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice * 100), 0);\n  return cents / 100;\n}\n`,
      tests: `import { invoiceTotal } from "./src/invoice-total.js";\nimport assert from "node:assert/strict";\nassert.equal(invoiceTotal([{ quantity: 3, unitPrice: 0.1 }]), 0.3);\nassert.equal(invoiceTotal([{ quantity: 2, unitPrice: 10.235 }]), 20.47);\n`
    },
    {
      file: "src/env-bool.js",
      initial: `export function envBool(value) {\n  return Boolean(value);\n}\n`,
      solution: `export function envBool(value) {\n  if (value === undefined || value === null || value === "") return false;\n  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());\n}\n`,
      tests: `import { envBool } from "./src/env-bool.js";\nimport assert from "node:assert/strict";\nassert.equal(envBool("true"), true);\nassert.equal(envBool("0"), false);\nassert.equal(envBool("OFF"), false);\nassert.equal(envBool("yes"), true);\n`
    },
    {
      file: "src/normalize-id.js",
      initial: `export function normalizeId(value) {\n  return value.toUpperCase();\n}\n`,
      solution: `export function normalizeId(value) {\n  return String(value).trim().replace(/[^a-z0-9]/gi, "").toUpperCase();\n}\n`,
      tests: `import { normalizeId } from "./src/normalize-id.js";\nimport assert from "node:assert/strict";\nassert.equal(normalizeId(" inv-42 "), "INV42");\nassert.equal(normalizeId("cust_007"), "CUST007");\n`
    },
    {
      file: "src/filter-window.js",
      initial: `export function filterWindow(items, start, end) {\n  return items.filter((item) => item.date > start && item.date < end);\n}\n`,
      solution: `export function filterWindow(items, start, end) {\n  return items.filter((item) => item.date >= start && item.date <= end);\n}\n`,
      tests: `import { filterWindow } from "./src/filter-window.js";\nimport assert from "node:assert/strict";\nconst items = [{ id: 1, date: "2026-01-01" }, { id: 2, date: "2026-01-15" }, { id: 3, date: "2026-02-01" }];\nassert.deepEqual(filterWindow(items, "2026-01-01", "2026-01-15").map((item) => item.id), [1, 2]);\n`
    },
    {
      file: "src/retry-delay.js",
      initial: `export function retryDelay(attempt) {\n  return 100 * 2 ** attempt;\n}\n`,
      solution: `export function retryDelay(attempt) {\n  return Math.min(5000, 100 * 2 ** Math.max(0, attempt));\n}\n`,
      tests: `import { retryDelay } from "./src/retry-delay.js";\nimport assert from "node:assert/strict";\nassert.equal(retryDelay(0), 100);\nassert.equal(retryDelay(3), 800);\nassert.equal(retryDelay(20), 5000);\n`
    },
    {
      file: "src/heading-anchor.js",
      initial: `export function headingAnchor(text) {\n  return "#" + text.toLowerCase().replaceAll(" ", "-");\n}\n`,
      solution: `export function headingAnchor(text) {\n  return "#" + String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");\n}\n`,
      tests: `import { headingAnchor } from "./src/heading-anchor.js";\nimport assert from "node:assert/strict";\nassert.equal(headingAnchor(" Runtime Config "), "#runtime-config");\nassert.equal(headingAnchor("API: v2.4!"), "#api-v2-4");\n`
    }
  ][index];
  return {
    ...base,
    prompt: `Fix the bug in ${cases.file}. Keep the public function name unchanged and make the included test file pass with Node.`,
    files: {
      "package.json": `{"type":"module","scripts":{"test":"node test.js"}}\n`,
      [cases.file]: cases.initial,
      "test.js": cases.tests
    },
    solution: { [cases.file]: cases.solution },
    verify: `set -euo pipefail\nnode test.js\nnode --check ${shell(cases.file)}\n`
  };
}

function multiSpec(base, index) {
  const feature = [
    ["--json", "json", "formatResult"],
    ["--version", "version", "versionBanner"],
    ["config defaults", "defaults", "loadSettings"],
    ["error codes", "errors", "formatError"],
    ["command aliases", "aliases", "resolveCommand"],
    ["quiet mode", "quiet", "shouldLog"],
    ["template partials", "partials", "renderTemplate"],
    ["metric labels", "metrics", "normalizeLabel"],
    ["repository root", "root", "findRepoRoot"],
    ["feature toggles", "toggles", "isEnabled"]
  ][index];
  const files = {
    "package.json": `{"type":"module","scripts":{"test":"node test.js"}}\n`,
    "src/index.js": `import { ${feature[2]} } from "./${feature[1]}.js";\n\nexport function run(input) {\n  return ${feature[2]}(input);\n}\n`,
    [`src/${feature[1]}.js`]: `export function ${feature[2]}(input) {\n  return String(input.name || input.command || "smith");\n}\n`,
    "test.js": `import assert from "node:assert/strict";\nimport { run } from "./src/index.js";\nassert.equal(run(${JSON.stringify(multiInput(index))}), ${JSON.stringify(expectedMulti(index))});\n`
  };
  const solution = {
    "src/index.js": `import { ${feature[2]} } from "./${feature[1]}.js";\n\nexport function run(input) {\n  return ${feature[2]}(input);\n}\n\nexport { ${feature[2]} } from "./${feature[1]}.js";\n`,
    [`src/${feature[1]}.js`]: multiSolution(index, feature[2])
  };
  return {
    ...base,
    prompt: `Update the small application to support ${feature[0]}. This requires reading the entry point, the helper module, and the test. Keep the existing run(input) export working.`,
    files,
    solution,
    verify: `set -euo pipefail\nnode test.js\nnode --check src/index.js\nnode --check src/${feature[1]}.js\n`
  };
}

function testsSpec(base, index) {
  const old = ["2026-05-01", "fixtures/input.txt", "pending", "smith help", "{\"b\":2,\"a\":1}", "1,234.50", "120000", "v1", "message", "agent"][index];
  const next = ["2026-05-16", "fixtures/sample.txt", "queued", "smith benchmark run", "{\"a\":1,\"b\":2}", "1234.50", "5000", "v2", "choices", "smith"][index];
  const assertion = JSON.stringify(next);
  return {
    ...base,
    prompt: `The implementation behavior has intentionally changed, but the test or fixture still expects the old value. Repair only the test-side files so the suite documents the new behavior and passes.`,
    files: {
      "package.json": `{"type":"module","scripts":{"test":"node test.js"}}\n`,
      "src/behavior.js": `export function currentValue() {\n  return ${assertion};\n}\n`,
      "test.js": `import assert from "node:assert/strict";\nimport { currentValue } from "./src/behavior.js";\nassert.equal(currentValue(), ${JSON.stringify(old)});\n`,
      "fixtures/README.md": `Expected value was ${old}; update tests to match current behavior.\n`
    },
    solution: {
      "test.js": `import assert from "node:assert/strict";\nimport { currentValue } from "./src/behavior.js";\nassert.equal(currentValue(), ${assertion});\n`,
      "fixtures/README.md": `Expected value is ${next}.\n`
    },
    verify: `set -euo pipefail\nnode test.js\nif grep -R ${shell(old)} test.js fixtures >/dev/null; then echo "old expectation still present" >&2; exit 1; fi\n`
  };
}

function shellSpec(base, index) {
  const scripts = [
    ["scripts/clean.sh", `#!/usr/bin/env bash\nrm -rf $1/*\n`, `#!/usr/bin/env bash\nset -euo pipefail\nroot=\${1:?usage: clean.sh <dir>}\nfind "$root" -mindepth 1 -maxdepth 1 -type f -delete\n`, `mkdir -p tmp/a && touch tmp/a/file tmp/a/.keep && bash scripts/clean.sh tmp/a && test -e tmp/a/.keep && test ! -e tmp/a/file`],
    ["scripts/backup.sh", `#!/usr/bin/env bash\ncp $1 backups/$1.bak\n`, `#!/usr/bin/env bash\nset -euo pipefail\nsrc=\${1:?usage: backup.sh <file>}\nmkdir -p backups\ncp "$src" "backups/$(basename "$src").bak"\n`, `mkdir -p "data dir" && echo ok > "data dir/source file.txt" && bash scripts/backup.sh "data dir/source file.txt" && test "$(cat "backups/source file.txt.bak")" = ok`],
    ["scripts/sort-counts.sh", `#!/usr/bin/env bash\nsort $1\n`, `#!/usr/bin/env bash\nset -euo pipefail\nsort -n "$1"\n`, `printf '10\\n2\\n1\\n' > counts.txt && test "$(bash scripts/sort-counts.sh counts.txt)" = "$(printf '1\\n2\\n10')"`],
    ["scripts/require-env.sh", `#!/usr/bin/env bash\necho "$APP_ENV"\n`, `#!/usr/bin/env bash\nset -euo pipefail\n: "\${APP_ENV:?APP_ENV is required}"\necho "$APP_ENV"\n`, `APP_ENV=prod bash scripts/require-env.sh | grep -qx prod && ! bash scripts/require-env.sh 2>/tmp/env.err && grep -q "APP_ENV is required" /tmp/env.err`],
    ["scripts/forward.sh", `#!/usr/bin/env bash\nnode tools/echo-args.js $@\n`, `#!/usr/bin/env bash\nset -euo pipefail\nnode tools/echo-args.js "$@"\n`, `test "$(bash scripts/forward.sh "two words" x)" = "two words|x"`],
    ["scripts/checksum.sh", `#!/usr/bin/env bash\nsha256sum manifest.txt\n`, `#!/usr/bin/env bash\nset -euo pipefail\nsha256sum "$1" | awk '{print $1}'\n`, `printf manifest > manifest.txt && test "$(bash scripts/checksum.sh manifest.txt)" = "$(sha256sum manifest.txt | awk '{print $1}')"`],
    ["scripts/log-rollup.sh", `#!/usr/bin/env bash\ngrep ERROR logs/*.log | wc -l\n`, `#!/usr/bin/env bash\nset -euo pipefail\ngrep -h "ERROR" logs/*.log | wc -l | tr -d ' '\n`, `mkdir -p logs && printf 'ERROR a\\nINFO b\\n' > logs/a.log && printf 'ERROR c\\n' > logs/b.log && test "$(bash scripts/log-rollup.sh)" = 2`],
    ["scripts/validate-tag.sh", `#!/usr/bin/env bash\n[[ $1 == v* ]]\n`, `#!/usr/bin/env bash\nset -euo pipefail\n[[ \${1:-} =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]\n`, `bash scripts/validate-tag.sh v1.2.3 && ! bash scripts/validate-tag.sh version1`],
    ["scripts/tmp-work.sh", `#!/usr/bin/env bash\ntmp=/tmp/work\nmkdir -p "$tmp"\necho done > "$tmp/result"\ncat "$tmp/result"\n`, `#!/usr/bin/env bash\nset -euo pipefail\ntmp=$(mktemp -d)\ntrap 'rm -rf "$tmp"' EXIT\necho done > "$tmp/result"\ncat "$tmp/result"\n`, `test "$(bash scripts/tmp-work.sh)" = done && test "$(bash scripts/tmp-work.sh)" = done`],
    ["scripts/filter.sh", `#!/usr/bin/env bash\ngrep -v '^#' $1\n`, `#!/usr/bin/env bash\nset -euo pipefail\ngrep -v '^#' "$1" || true\n`, `printf '#hide\\nkeep\\n' > input.txt && test "$(bash scripts/filter.sh input.txt)" = keep`]
  ][index];
  return {
    ...base,
    prompt: `Repair ${scripts[0]} so it behaves correctly in ordinary shell usage. Keep it portable Bash and do not add external dependencies.`,
    files: {
      [scripts[0]]: scripts[1],
      "tools/echo-args.js": `console.log(process.argv.slice(2).join("|"));\n`
    },
    solution: { [scripts[0]]: scripts[2] },
    executable: [scripts[0]],
    verify: `set -euo pipefail\n${scripts[3]}\nbash -n ${shell(scripts[0])}\n`
  };
}

function configSpec(base, index) {
  const specs = [
    ["package.json", `{"scripts":{"test":"node test.js"}}\n`, `{"scripts":{"test":"node test.js","lint":"node --check src/index.js"}}\n`, `const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); assert.equal(pkg.scripts.lint,"node --check src/index.js");`],
    [".smith/config.toml", `default_profile = "dev"\n\n[profiles.dev]\nmodel = "gpt-5.4-mini"\n`, `default_profile = "dev"\n\n[profiles.dev]\nmodel = "gpt-5.4-mini"\ntemperature = 0.1\nreasoning_effort = "low"\n`, `const text=fs.readFileSync(".smith/config.toml","utf8"); assert.match(text,/temperature = 0\\.1/); assert.match(text,/reasoning_effort = "low"/);`],
    ["service.yaml", `service:\n  name: smith-api\n  port: 3000\n`, `service:\n  name: smith-api\n  port: 8080\n  readiness: /health\n`, `const text=fs.readFileSync("service.yaml","utf8"); assert.match(text,/port: 8080/); assert.match(text,/readiness: \\/health/);`],
    ["schema.json", `{"type":"object","properties":{"name":{"type":"string"}}}\n`, `{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}\n`, `const s=JSON.parse(fs.readFileSync("schema.json","utf8")); assert.deepEqual(s.required,["name"]);`],
    [".editorconfig", `root = true\n[*]\nindent_style = space\n`, `root = true\n[*]\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\n`, `const text=fs.readFileSync(".editorconfig","utf8"); assert.match(text,/indent_size = 2/); assert.match(text,/insert_final_newline = true/);`],
    [".github/workflows/test.yml", `jobs:\n  test:\n    strategy:\n      matrix:\n        node: [20]\n`, `jobs:\n  test:\n    strategy:\n      matrix:\n        node: [20, 22]\n`, `const text=fs.readFileSync(".github/workflows/test.yml","utf8"); assert.match(text,/node: \\[20, 22\\]/);`],
    [".eslintignore", `dist\nnode_modules\nsrc/generated\n`, `dist\nnode_modules\n`, `const text=fs.readFileSync(".eslintignore","utf8"); assert.ok(!text.includes("src/generated"));`],
    ["compose.yaml", `services:\n  api:\n    image: smith-api\n`, `services:\n  api:\n    image: smith-api\n    healthcheck:\n      test: ["CMD", "node", "healthcheck.js"]\n`, `const text=fs.readFileSync("compose.yaml","utf8"); assert.match(text,/healthcheck:/); assert.match(text,/node", "healthcheck\\.js"/);`],
    ["settings.json", `{"theme":"dark","retries":"3"}\n`, `{"theme":"dark","retries":3,"telemetry":false}\n`, `const s=JSON.parse(fs.readFileSync("settings.json","utf8")); assert.equal(s.retries,3); assert.equal(s.telemetry,false);`],
    ["release.json", `{"version":"1.2.0","channel":"latest"}\n`, `{"version":"1.2.0","channel":"stable"}\n`, `const s=JSON.parse(fs.readFileSync("release.json","utf8")); assert.equal(s.channel,"stable");`]
  ][index];
  return {
    ...base,
    prompt: `Update ${specs[0]} to match the requested project configuration change described in the file comments or surrounding context. Keep the file valid and preserve unrelated settings.`,
    files: { [specs[0]]: specs[1], "src/index.js": `console.log("ok");\n` },
    solution: { [specs[0]]: specs[2] },
    verify: `set -euo pipefail\nnode <<'NODE'\nconst fs = require("node:fs");\nconst assert = require("node:assert/strict");\n${specs[3]}\nNODE\n`
  };
}

function dataSpec(base, index) {
  const outputs = [
    ["data/customers.csv", "reports/customers.json", `id,name\n1,Ada\n2,Grace\n`, `[\n  {"id":1,"name":"Ada"},\n  {"id":2,"name":"Grace"}\n]\n`],
    ["data/customers.json", "reports/customers.json", `[{"id":1,"email":"a@example.com"},{"id":1,"email":"a@example.com"},{"id":2,"email":"b@example.com"}]\n`, `[\n  {"id":1,"email":"a@example.com"},\n  {"id":2,"email":"b@example.com"}\n]\n`],
    ["data/sales.csv", "reports/sales-total.txt", `region,total\nwest,10\nwest,15\neast,7\n`, `east 7\nwest 25\n`],
    ["data/tags.txt", "reports/tags.txt", ` Beta \nalpha\nALPHA\n`, `alpha\nbeta\n`],
    ["data/inventory-a.json", "reports/inventory.json", `[{"sku":"a","qty":2}]\n`, `[\n  {"sku":"a","qty":5},\n  {"sku":"b","qty":4}\n]\n`, { "data/inventory-b.json": `[{"sku":"a","qty":3},{"sku":"b","qty":4}]\n` }],
    ["data/ledger.csv", "reports/debits.csv", `type,amount\ndebit,5\ncredit,8\ndebit,3\n`, `type,amount\ndebit,5\ndebit,3\n`],
    ["data/notes.txt", "reports/notes.txt", `2026-05-16 Added API\n2026-05-01 Started\n`, `2026-05-01 Started\n2026-05-16 Added API\n`],
    ["data/users.json", "reports/users.json", `[{"name":"Ada","token":"secret","role":"admin"}]\n`, `[\n  {"name":"Ada","role":"admin"}\n]\n`],
    ["data/sla.csv", "reports/sla.txt", `name,ms\na,80\nb,250\nc,1200\n`, `fast 1\nnormal 1\nslow 1\n`],
    ["data/table.txt", "reports/table.md", `Name | Role\nAda | Admin\nGrace | User\n`, `| Name | Role |\n| --- | --- |\n| Ada | Admin |\n| Grace | User |\n`]
  ][index];
  return {
    ...base,
    prompt: `Transform the data in ${outputs[0]} into ${outputs[1]}. Add a small script if useful, but the final report file must contain the transformed data deterministically.`,
    files: { [outputs[0]]: outputs[2], ...(outputs[4] ?? {}) },
    solution: { [outputs[1]]: outputs[3] },
    verify: exactFileVerifier(outputs[1], outputs[3])
  };
}

function edgeSpec(base, index) {
  const cases = [
    ["src/stats.js", `export function average(values){return values.reduce((a,b)=>a+b,0)/values.length;}\n`, `export function average(values){return values.length === 0 ? 0 : values.reduce((a,b)=>a+b,0)/values.length;}\n`, `assert.equal(average([]),0); assert.equal(average([2,4]),3);`],
    ["src/clean.js", `export function clean(value){return value.trim();}\n`, `export function clean(value){return String(value).replace(/^\\s+|\\s+$/gu, "");}\n`, `assert.equal(clean("\\u00a0Smith\\u00a0"),"Smith");`],
    ["src/format-number.js", `export function formatNumber(value){return String(value);}\n`, `export function formatNumber(value){return Object.is(value, -0) ? "0" : String(value);}\n`, `assert.equal(formatNumber(-0),"0"); assert.equal(formatNumber(3),"3");`],
    ["src/get.js", `export function get(obj,path){return path.split(".").reduce((o,k)=>o[k],obj);}\n`, `export function get(obj,path){return path.split(".").reduce((o,k)=>o == null ? undefined : o[k],obj);}\n`, `assert.equal(get({a:{}}, "a.b.c"), undefined);`],
    ["src/query.js", `export function toQuery(input){return Object.entries(input).map(([k,v])=>k+"="+v).join("&");}\n`, `export function toQuery(input){return Object.entries(input).flatMap(([k,v]) => Array.isArray(v) ? v.map((item)=>[k,item]) : [[k,v]]).map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&");}\n`, `assert.equal(toQuery({tag:["a","b"], q:"x y"}),"tag=a&tag=b&q=x%20y");`],
    ["src/ext.js", `export function ext(path){return path.slice(path.lastIndexOf("."));}\n`, `export function ext(path){const base=path.split("/").pop() ?? ""; const dot=base.lastIndexOf("."); return dot <= 0 ? "" : base.slice(dot);}\n`, `assert.equal(ext(".env"),""); assert.equal(ext("a/b.txt"),".txt");`],
    ["src/range.js", `export function overlaps(a,b){return a.start < b.end && b.start < a.end;}\n`, `export function overlaps(a,b){return a.start <= b.end && b.start <= a.end;}\n`, `assert.equal(overlaps({start:1,end:3},{start:3,end:4}),true);`],
    ["src/json-lines.js", `export function parseLines(text){return text.split("\\n").map(JSON.parse);}\n`, `export function parseLines(text){return text.split("\\n").filter(Boolean).map(JSON.parse);}\n`, `assert.deepEqual(parseLines('{"a":1}\\n'),[{a:1}]);`],
    ["src/table.js", `export function splitRow(row){return row.split("|");}\n`, `export function splitRow(row){const cells=[]; let cell=""; let escaped=false; for (const ch of row){ if (escaped){ cell += ch; escaped=false; } else if (ch === "\\\\"){ escaped=true; } else if (ch === "|"){ cells.push(cell); cell=""; } else { cell += ch; }} cells.push(cell); return cells;}\n`, `assert.deepEqual(splitRow("a\\\\|b|c"),["a|b","c"]);`],
    ["src/semver.js", `export function sortVersions(values){return values.sort();}\n`, `export function sortVersions(values){return [...values].sort((a,b)=>a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));}\n`, `assert.deepEqual(sortVersions(["1.0.10","1.0.2","1.0.2-beta"]),["1.0.2","1.0.2-beta","1.0.10"]);`]
  ][index];
  const exportName = /function\s+(\w+)/.exec(cases[1])?.[1] ?? "value";
  return {
    ...base,
    prompt: `Fix the edge case in ${cases[0]} without changing the exported function name. The included test describes the behavior expected by callers.`,
    files: {
      "package.json": `{"type":"module","scripts":{"test":"node test.js"}}\n`,
      [cases[0]]: cases[1],
      "test.js": `import assert from "node:assert/strict";\nimport { ${exportName} } from "./${cases[0]}";\n${cases[3]}\n`
    },
    solution: { [cases[0]]: cases[2] },
    verify: `set -euo pipefail\nnode test.js\n`
  };
}

function docsSpec(base, index) {
  const docs = [
    ["docs/cli.md", "smith benchmark run <task-or-directory>", "Add benchmark command usage to the CLI guide."],
    ["docs/troubleshooting.md", "Check ~/.smith/runs for the trace", "Add a troubleshooting entry for failed runs."],
    ["docs/config.md", "danger_review = \"off|ask|llm\"", "Sync the config reference with danger review modes."],
    ["CONTRIBUTING.md", "Run npm run check before opening a PR", "Add contributor test guidance."],
    ["CHANGELOG.md", "Added Docker benchmark runner", "Backfill the latest changelog entry."],
    ["docs/adr-001-runtime.md", "Decision: Smith executes model output as shell input", "Create an ADR for the runtime model."],
    ["scripts/README.md", "validate-benchmarks checks task structure", "Document the repository scripts."],
    ["docs/api-examples.md", "adapter = \"openai-chat\"", "Refresh the provider example."],
    ["docs/security.md", "Danger review is a backstop, not a sandbox", "Add a security note for shell execution."],
    ["docs/migration.md", "Replace agent with smith in command examples", "Add a migration step for command renaming."]
  ][index];
  return {
    ...base,
    prompt: `${docs[2]} Keep the documentation concise and preserve the existing heading.`,
    files: { [docs[0]]: `# ${toTitle(docs[0].split("/").pop().replace(/\..*/, ""))}\n\nTODO: update this page.\n` },
    solution: { [docs[0]]: `# ${toTitle(docs[0].split("/").pop().replace(/\..*/, ""))}\n\n${docs[1]}.\n` },
    verify: verifierIncludes(docs[0], [docs[1]])
  };
}

function hardSpec(base, index) {
  const scenario = [
    ["router", "Add aliases, unknown-command errors, and help output", "resolveCommand"],
    ["plugins", "Load plugin metadata, reject duplicate ids, and sort by id", "loadPlugins"],
    ["cache", "Normalize cache keys across query order and casing", "cacheKey"],
    ["reports", "Group records, emit JSON and Markdown, and handle empty input", "buildReport"],
    ["runner", "Add per-task timeout handling and result summaries", "runTasks"],
    ["audit", "Scan workspace files and summarize missing required files", "auditWorkspace"],
    ["release", "Plan stable and beta releases from manifest files", "planRelease"],
    ["loader", "Merge config defaults, project overrides, and validation errors", "loadConfig"],
    ["indexer", "Index Markdown headings with duplicate anchor suffixes", "indexMarkdown"],
    ["billing", "Apply tiered rates, minimum charges, and discounts", "calculateInvoice"],
    ["workflow", "Compile workflow events from scattered policy docs, JSON config, fixtures, and source modules", "compileWorkflow"]
  ][index];
  return {
    ...base,
    prompt:
      scenario[0] === "workflow"
        ? "Complete the workflow policy engine. The behavior is spread across docs, JSON config, fixtures, tests, and multiple source modules: normalize events, apply plan-specific deployment approvals, block high-risk deployments without emergency override, emit workflow actions, summarize audit counts, and update the README. This is intentionally challenging; broad discovery across independent files is useful before editing."
        : `Complete the ${scenario[0]} utility. ${scenario[1]}. This is intentionally multi-step: inspect all files, update implementation and docs, then run the test script.`,
    files: hardInitial(scenario[0], scenario[2]),
    solution: hardSolution(scenario[0], scenario[2]),
    verify:
      scenario[0] === "workflow"
        ? workflowVerifier()
        : `set -euo pipefail\nnode test.js\nnode --check src/${scenario[0]}.js\ngrep -q "## Verification" README.md\n`
  };
}

function hardInitial(name, fn) {
  if (name === "workflow") return workflowInitial();
  return {
    "package.json": `{"type":"module","scripts":{"test":"node test.js"}}\n`,
    "README.md": `# ${toTitle(name)} Utility\n\nDocument the finished behavior.\n`,
    [`src/${name}.js`]: `export function ${fn}(input) {\n  return input;\n}\n`,
    "test.js": hardTest(name, fn)
  };
}

function hardSolution(name, fn) {
  if (name === "workflow") return workflowSolution();
  return {
    "README.md": `# ${toTitle(name)} Utility\n\nThe utility implements the requested behavior and is covered by the local test script.\n\n## Verification\n\nRun \`node test.js\` from the workspace.\n`,
    [`src/${name}.js`]: hardImplementation(name, fn)
  };
}

function hardTest(name, fn) {
  if (name === "workflow") return workflowTest();
  const assertions = {
    router: `assert.deepEqual(${fn}(["start", "s", "missing"]), [{command:"start"},{command:"start"},{error:"unknown command: missing"}]);`,
    plugins: `assert.deepEqual(${fn}([{id:"b"},{id:"a"}]).map((p)=>p.id), ["a","b"]); assert.throws(()=>${fn}([{id:"a"},{id:"a"}]), /duplicate/);`,
    cache: `assert.equal(${fn}("GET", "/Api", { b: 2, a: 1 }), "get:/api?a=1&b=2");`,
    reports: `assert.deepEqual(${fn}([{team:"a",score:2},{team:"a",score:3}]).json, [{team:"a",score:5}]); assert.match(${fn}([]).markdown, /No records/);`,
    runner: `assert.deepEqual(${fn}([{name:"a",ms:5},{name:"b",ms:20}], 10), [{name:"a",status:"pass"},{name:"b",status:"timeout"}]);`,
    audit: `assert.deepEqual(${fn}(["Task.md","workspace"], ["Task.md","workspace","verify.sh"]), ["verify.sh"]);`,
    release: `assert.deepEqual(${fn}([{version:"1.0.0", channel:"beta"},{version:"0.9.0", channel:"stable"}]), {stable:"0.9.0", beta:"1.0.0"});`,
    loader: `assert.deepEqual(${fn}({timeout:10},{timeout:20, mode:"fast"}), {config:{timeout:20, mode:"fast"}, errors:[]}); assert.equal(${fn}({},{timeout:-1}).errors.length, 1);`,
    indexer: `assert.deepEqual(${fn}("# Intro\\n## API\\n## API"), [{level:1,title:"Intro",anchor:"intro"},{level:2,title:"API",anchor:"api"},{level:2,title:"API",anchor:"api-2"}]);`,
    billing: `assert.deepEqual(${fn}({units:12, discount:0.1}), {subtotal:22, total:19.8});`
  }[name];
  return `import assert from "node:assert/strict";\nimport { ${fn} } from "./src/${name}.js";\n${assertions}\n`;
}

function hardImplementation(name, fn) {
  if (name === "workflow") return workflowSolution()["src/workflow.js"];
  const implementations = {
    router: `const aliases = new Map([["s", "start"], ["t", "test"], ["b", "build"]]);\nconst commands = new Set(["start", "test", "build", "help"]);\n\nexport function ${fn}(input) {\n  return input.map((raw) => {\n    const command = aliases.get(raw) ?? raw;\n    return commands.has(command) ? { command } : { error: ` + "`unknown command: ${raw}`" + ` };\n  });\n}\n`,
    plugins: `export function ${fn}(plugins) {\n  const seen = new Set();\n  for (const plugin of plugins) {\n    if (seen.has(plugin.id)) throw new Error(` + "`duplicate plugin id: ${plugin.id}`" + `);\n    seen.add(plugin.id);\n  }\n  return [...plugins].sort((a, b) => a.id.localeCompare(b.id));\n}\n`,
    cache: `export function ${fn}(method, path, query = {}) {\n  const params = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => String(key) + "=" + String(value)).join("&");\n  return method.toLowerCase() + ":" + path.toLowerCase() + (params ? "?" + params : "");\n}\n`,
    reports: `export function ${fn}(records) {\n  if (records.length === 0) return { json: [], markdown: "No records\\n" };\n  const totals = new Map();\n  for (const record of records) totals.set(record.team, (totals.get(record.team) ?? 0) + record.score);\n  const json = [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([team, score]) => ({ team, score }));\n  const markdown = ["| Team | Score |", "| --- | --- |", ...json.map((row) => ` + "`| ${row.team} | ${row.score} |`" + `)].join("\\n") + "\\n";\n  return { json, markdown };\n}\n`,
    runner: `export function ${fn}(tasks, timeoutMs) {\n  return tasks.map((task) => ({ name: task.name, status: task.ms > timeoutMs ? "timeout" : "pass" }));\n}\n`,
    audit: `export function ${fn}(present, required) {\n  const files = new Set(present);\n  return required.filter((file) => !files.has(file));\n}\n`,
    release: `export function ${fn}(releases) {\n  return releases.reduce((plan, release) => ({ ...plan, [release.channel]: release.version }), {});\n}\n`,
    loader: `export function ${fn}(defaults, project) {\n  const config = { ...defaults, ...project };\n  const errors = [];\n  if (config.timeout !== undefined && config.timeout <= 0) errors.push("timeout must be positive");\n  return { config, errors };\n}\n`,
    indexer: `function anchor(title) {\n  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");\n}\n\nexport function ${fn}(markdown) {\n  const counts = new Map();\n  return markdown.split("\\n").filter((line) => /^#+\\s/.test(line)).map((line) => {\n    const level = line.match(/^#+/)[0].length;\n    const title = line.replace(/^#+\\s*/, "");\n    const base = anchor(title);\n    const count = (counts.get(base) ?? 0) + 1;\n    counts.set(base, count);\n    return { level, title, anchor: count === 1 ? base : base + "-" + count };\n  });\n}\n`,
    billing: `export function ${fn}({ units, discount = 0 }) {\n  const first = Math.min(units, 10) * 2;\n  const extra = Math.max(0, units - 10) * 1;\n  const subtotal = Math.max(5, first + extra);\n  return { subtotal, total: subtotal * (1 - discount) };\n}\n`
  };
  return implementations[name];
}

function workflowInitial() {
  return {
    "package.json": `{"type":"module","scripts":{"test":"node test.js"}}\n`,
    "README.md": `# Workflow Policy Engine\n\nCompile incoming product events into workflow decisions.\n\nTODO: document the finished behavior.\n`,
    "docs/policies.md": `# Workflow Policies\n\nDeployment events use plan-specific approval thresholds:\n\n- free plans require 1 approval.\n- team plans require 3 approvals.\n- enterprise plans require 10 approvals.\n\nHigh-risk deployments are blocked unless the event has an emergency override. Billing failures are warning severity below 1000 and critical severity at 1000 or higher. Unknown events should be kept visible as ignored triage decisions.\n`,
    "docs/actions.md": `# Action Contract\n\nThe engine emits action objects for decisions that can proceed:\n\n- ready deployments schedule a deploy.\n- deployments missing approvals request approval from configured approvers who have not already approved.\n- incidents page the owning on-call team.\n- billing failures notify finance with the account and severity.\n\nBlocked and ignored decisions do not emit actions.\n`,
    "config/workflows.json": `{
  "plans": {
    "free": { "requiredApprovals": 1, "approvers": ["owner"] },
    "team": { "requiredApprovals": 3, "approvers": ["ops-lead", "security", "service-owner"] },
    "enterprise": { "requiredApprovals": 10, "approvers": ["ops-lead", "security", "compliance", "director"] }
  },
  "routes": {
    "deploy.requested": "ops",
    "incident.opened": "incident",
    "billing.failed": "finance"
  },
  "billing": {
    "criticalAmount": 1000
  }
}
`,
    "fixtures/events.json": `[
  {
    "id": "deploy-high",
    "type": " deploy.requested ",
    "plan": "TEAM",
    "risk": "HIGH",
    "approvals": ["ops-lead"]
  },
  {
    "id": "deploy-ready",
    "type": "deploy.requested",
    "plan": "free",
    "risk": "normal",
    "approvals": ["owner"]
  },
  {
    "id": "incident-1",
    "type": "incident.opened",
    "team": "payments"
  },
  {
    "id": "billing-1",
    "type": "billing.failed",
    "account": "acct_1",
    "amount": 1200
  }
]
`,
    "src/events.js": `export function normalizeEvent(raw) {\n  return raw;\n}\n`,
    "src/policy.js": `import { readFileSync } from "node:fs";\n\nexport function loadWorkflowConfig() {\n  return JSON.parse(readFileSync(new URL("../config/workflows.json", import.meta.url), "utf8"));\n}\n\nexport function resolvePolicy(event, config = loadWorkflowConfig()) {\n  return {\n    route: config.routes[event.type] ?? "triage",\n    status: "ready",\n    severity: "normal",\n    requiredApprovals: 0,\n    missingApprovals: 0,\n    reasons: [],\n    approvers: []\n  };\n}\n`,
    "src/actions.js": `export function buildActions(event, policy) {\n  return [];\n}\n`,
    "src/audit.js": `export function summarizeAudit(decisions) {\n  return { total: decisions.length };\n}\n`,
    "src/workflow.js": `import { summarizeAudit } from "./audit.js";\n\nexport function compileWorkflow(events, options = {}) {\n  return {\n    generatedAt: options.now ?? null,\n    decisions: events,\n    audit: summarizeAudit(events)\n  };\n}\n`,
    "test.js": workflowTest()
  };
}

function workflowSolution() {
  return {
    "README.md": `# Workflow Policy Engine\n\nCompile incoming product events into workflow decisions by normalizing event input, applying configured plan policies, emitting follow-up actions, and producing an audit summary.\n\nDeployments use plan-specific approval thresholds. High-risk deployments are blocked unless they carry an emergency override. Incidents page the owning on-call team, billing failures notify finance, and unknown event types are retained as ignored triage decisions.\n\n## Verification\n\nRun \`node test.js\` from the workspace.\n`,
    "src/events.js": `export function normalizeEvent(raw) {\n  const type = String(raw.type ?? "").trim();\n  const planValue = String(raw.plan ?? "free").trim().toLowerCase();\n  const riskValue = String(raw.risk ?? "normal").trim().toLowerCase();\n  const amount = Number(raw.amount ?? 0);\n  return {\n    ...raw,\n    type,\n    plan: planValue || "free",\n    risk: riskValue || "normal",\n    approvals: Array.isArray(raw.approvals) ? raw.approvals.filter(Boolean) : [],\n    amount: Number.isFinite(amount) ? amount : 0,\n    emergency: raw.emergency === true\n  };\n}\n`,
    "src/policy.js": `import { readFileSync } from "node:fs";\n\nexport function loadWorkflowConfig() {\n  return JSON.parse(readFileSync(new URL("../config/workflows.json", import.meta.url), "utf8"));\n}\n\nexport function resolvePolicy(event, config = loadWorkflowConfig()) {\n  const route = config.routes[event.type] ?? "triage";\n  if (event.type === "deploy.requested") {\n    const plan = config.plans[event.plan] ?? config.plans.free;\n    const requiredApprovals = plan.requiredApprovals;\n    const missingApprovals = Math.max(0, requiredApprovals - event.approvals.length);\n    const reasons = event.risk === "high" && !event.emergency ? ["high risk deployment requires emergency override"] : [];\n    return {\n      route,\n      status: reasons.length > 0 ? "blocked" : missingApprovals > 0 ? "pending" : "ready",\n      severity: event.risk === "high" ? "critical" : "normal",\n      requiredApprovals,\n      missingApprovals,\n      reasons,\n      approvers: plan.approvers\n    };\n  }\n  if (event.type === "incident.opened") {\n    return { route, status: "ready", severity: "critical", requiredApprovals: 0, missingApprovals: 0, reasons: [], approvers: [] };\n  }\n  if (event.type === "billing.failed") {\n    const severity = event.amount >= config.billing.criticalAmount ? "critical" : "warning";\n    return { route, status: "ready", severity, requiredApprovals: 0, missingApprovals: 0, reasons: [], approvers: [] };\n  }\n  return {\n    route,\n    status: "ignored",\n    severity: "normal",\n    requiredApprovals: 0,\n    missingApprovals: 0,\n    reasons: [` + "`unsupported event type: ${event.type || \"unknown\"}`" + `],\n    approvers: []\n  };\n}\n`,
    "src/actions.js": `export function buildActions(event, policy) {\n  if (policy.status === "blocked" || policy.status === "ignored") return [];\n  if (event.type === "deploy.requested") {\n    if (policy.missingApprovals > 0) {\n      const approved = new Set(event.approvals);\n      return [\n        {\n          type: "request_approval",\n          route: policy.route,\n          approvers: policy.approvers.filter((approver) => !approved.has(approver)).slice(0, policy.missingApprovals)\n        }\n      ];\n    }\n    return [{ type: "schedule_deploy", route: policy.route }];\n  }\n  if (event.type === "incident.opened") {\n    return [{ type: "page_oncall", route: policy.route, team: event.team ?? "platform" }];\n  }\n  if (event.type === "billing.failed") {\n    return [{ type: "notify_finance", route: policy.route, account: event.account ?? "unknown", severity: policy.severity }];\n  }\n  return [];\n}\n`,
    "src/audit.js": `export function summarizeAudit(decisions) {\n  const byStatus = {};\n  const byRoute = {};\n  let actionCount = 0;\n  for (const decision of decisions) {\n    byStatus[decision.status] = (byStatus[decision.status] ?? 0) + 1;\n    byRoute[decision.route] = (byRoute[decision.route] ?? 0) + 1;\n    actionCount += decision.actions.length;\n  }\n  return { total: decisions.length, actionCount, byStatus, byRoute };\n}\n`,
    "src/workflow.js": `import { buildActions } from "./actions.js";\nimport { summarizeAudit } from "./audit.js";\nimport { normalizeEvent } from "./events.js";\nimport { loadWorkflowConfig, resolvePolicy } from "./policy.js";\n\nexport function compileWorkflow(events, options = {}) {\n  const config = loadWorkflowConfig();\n  const decisions = events.map((raw) => {\n    const event = normalizeEvent(raw);\n    const policy = resolvePolicy(event, config);\n    const actions = buildActions(event, policy);\n    return {\n      id: event.id,\n      type: event.type,\n      route: policy.route,\n      status: policy.status,\n      severity: policy.severity,\n      requiredApprovals: policy.requiredApprovals,\n      missingApprovals: policy.missingApprovals,\n      reasons: policy.reasons,\n      actions\n    };\n  });\n  return { generatedAt: options.now ?? null, decisions, audit: summarizeAudit(decisions) };\n}\n`
  };
}

function workflowTest() {
  return `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { compileWorkflow } from "./src/workflow.js";\n\nconst events = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"));\nconst result = compileWorkflow(events, { now: "2026-05-23T12:00:00Z" });\nconst decisions = new Map(result.decisions.map((decision) => [decision.id, decision]));\n\nassert.equal(result.generatedAt, "2026-05-23T12:00:00Z");\nassert.deepEqual(decisions.get("deploy-high"), {\n  id: "deploy-high",\n  type: "deploy.requested",\n  route: "ops",\n  status: "blocked",\n  severity: "critical",\n  requiredApprovals: 3,\n  missingApprovals: 2,\n  reasons: ["high risk deployment requires emergency override"],\n  actions: []\n});\nassert.deepEqual(decisions.get("deploy-ready").actions, [{ type: "schedule_deploy", route: "ops" }]);\nassert.deepEqual(decisions.get("incident-1").actions, [{ type: "page_oncall", route: "incident", team: "payments" }]);\nassert.deepEqual(decisions.get("billing-1").actions, [\n  { type: "notify_finance", route: "finance", account: "acct_1", severity: "critical" }\n]);\nassert.deepEqual(result.audit, {\n  total: 4,\n  actionCount: 3,\n  byStatus: { blocked: 1, ready: 3 },\n  byRoute: { ops: 2, incident: 1, finance: 1 }\n});\n`;
}

function workflowVerifier() {
  return `set -euo pipefail\nnode test.js\nfind src -name '*.js' -print0 | xargs -0 -n1 node --check\ngrep -q "## Verification" README.md\nnode --input-type=module <<'NODE'\nimport assert from "node:assert/strict";\nimport { compileWorkflow } from "./src/workflow.js";\n\nconst result = compileWorkflow([\n  { id: "enterprise-emergency", type: "deploy.requested", plan: "enterprise", risk: "high", emergency: true, approvals: ["ops-lead", "security"] },\n  { id: "billing-warning", type: "billing.failed", account: "acct_2", amount: 999 },\n  { id: "unknown-1", type: "data.exported" }\n]);\nconst decisions = new Map(result.decisions.map((decision) => [decision.id, decision]));\nassert.equal(decisions.get("enterprise-emergency").status, "pending");\nassert.equal(decisions.get("enterprise-emergency").requiredApprovals, 10);\nassert.equal(decisions.get("enterprise-emergency").missingApprovals, 8);\nassert.deepEqual(decisions.get("enterprise-emergency").actions, [\n  { type: "request_approval", route: "ops", approvers: ["compliance", "director"] }\n]);\nassert.equal(decisions.get("billing-warning").severity, "warning");\nassert.equal(decisions.get("unknown-1").route, "triage");\nassert.equal(decisions.get("unknown-1").status, "ignored");\nassert.deepEqual(decisions.get("unknown-1").actions, []);\nassert.deepEqual(result.audit.byStatus, { pending: 1, ready: 1, ignored: 1 });\nNODE\n`;
}

function expectedMulti(index) {
  return [
    '{"name":"smith","command":"start","enabled":true}',
    "smith v1",
    "smith:3000",
    "E_START: smith",
    "start",
    "",
    "Hello smith",
    "smith_command_start",
    "/repo",
    "enabled"
  ][index];
}

function multiInput(index) {
  const input = { name: "smith", command: "start", enabled: true };
  if (index === 5) input.quiet = true;
  return input;
}

function multiSolution(index, fn) {
  const bodies = [
    `return JSON.stringify(input);`,
    `return "smith v1";`,
    `return "smith:" + String(input.port ?? 3000);`,
    `return ` + "`E_START: ${input.name}`" + `;`,
    `const aliases = { s: "start", t: "test" };\n  return aliases[input.command] ?? input.command;`,
    `return input.quiet ? "" : String(input.name ?? "smith");`,
    `return ` + "`Hello ${input.name}`" + `;`,
    `return (String(input.name) + "_command_" + String(input.command)).replace(/[^a-z0-9]+/gi, "_").toLowerCase();`,
    `return input.root ?? "/repo";`,
    `return input.enabled ? "enabled" : "disabled";`
  ];
  return `export function ${fn}(input) {\n  ${bodies[index]}\n}\n`;
}

function writeTask(spec) {
  const taskDir = join(benchmarksRoot, spec.slug);
  mkdirSync(join(taskDir, "workspace"), { recursive: true });
  writeFileSync(join(taskDir, "Task.md"), taskMarkdown(spec), "utf8");
  for (const [path, content] of Object.entries(spec.files)) {
    const file = join(taskDir, "workspace", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  for (const path of spec.executable ?? []) chmodSync(join(taskDir, "workspace", path), 0o755);
  writeFileSync(join(taskDir, "verify.sh"), spec.verify.endsWith("\n") ? spec.verify : `${spec.verify}\n`, "utf8");
  chmodSync(join(taskDir, "verify.sh"), 0o755);
}

function taskMarkdown(spec) {
  return `# ${spec.title}\n\nDifficulty: ${spec.difficulty}\n\n${spec.prompt}\n\nWork inside the provided workspace. Keep the task self-contained and do not use network access, secrets, package installs, or privileged commands.\n`;
}

function verifierIncludes(file, includes, unchanged = []) {
  return `set -euo pipefail\ntest -f ${shell(file)}\nnode <<'NODE'\nconst fs = require("node:fs");\nconst text = fs.readFileSync(${JSON.stringify(file)}, "utf8");\nfor (const expected of ${JSON.stringify(includes)}) {\n  if (!text.includes(expected)) throw new Error(` + "`missing expected content: ${expected}`" + `);\n}\nfor (const path of ${JSON.stringify(unchanged)}) {\n  if (!fs.existsSync(path)) throw new Error(` + "`missing source file: ${path}`" + `);\n}\nNODE\n`;
}

function exactFileVerifier(file, expected) {
  return `set -euo pipefail\ntest -f ${shell(file)}\nnode <<'NODE'\nconst fs = require("node:fs");\nconst assert = require("node:assert/strict");\nassert.equal(fs.readFileSync(${JSON.stringify(file)}, "utf8"), ${JSON.stringify(expected)});\nNODE\n`;
}

function toTitle(value) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function shell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function main() {
  rmSync(benchmarksRoot, { recursive: true, force: true });
  mkdirSync(benchmarksRoot, { recursive: true });
  for (const spec of taskSpecs()) writeTask(spec);
  console.log(`generated ${taskSpecs().length} benchmark tasks in ${benchmarksRoot}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { taskSpecs };
