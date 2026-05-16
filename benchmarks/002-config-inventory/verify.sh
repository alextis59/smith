set -euo pipefail
test -f 'audit.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("audit.md", "utf8");
for (const expected of ["Runtime Config","SMITH_PROFILE","runtime.timeout_ms","danger_review"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of ["notes/source-a.md","notes/source-b.md"]) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
