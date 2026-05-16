set -euo pipefail
test -f 'summary.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("summary.md", "utf8");
for (const expected of ["Flags","beta_search disabled","receipt_v2 enabled","legacy_import remove"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of ["notes/source-a.md","notes/source-b.md"]) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
