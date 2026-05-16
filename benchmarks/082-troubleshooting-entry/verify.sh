set -euo pipefail
test -f 'docs/troubleshooting.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("docs/troubleshooting.md", "utf8");
for (const expected of ["Check ~/.smith/runs for the trace"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
