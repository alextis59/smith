set -euo pipefail
test -f 'docs/adr-001-runtime.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("docs/adr-001-runtime.md", "utf8");
for (const expected of ["Decision: Smith executes model output as shell input"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
