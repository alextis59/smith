set -euo pipefail
test -f 'scripts/README.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("scripts/README.md", "utf8");
for (const expected of ["validate-benchmarks checks task structure"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
