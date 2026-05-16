set -euo pipefail
test -f 'docs/security.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("docs/security.md", "utf8");
for (const expected of ["Danger review is a backstop, not a sandbox"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
