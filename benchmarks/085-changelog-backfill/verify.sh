set -euo pipefail
test -f 'CHANGELOG.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("CHANGELOG.md", "utf8");
for (const expected of ["Added Docker benchmark runner"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
