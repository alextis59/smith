set -euo pipefail
test -f 'CONTRIBUTING.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("CONTRIBUTING.md", "utf8");
for (const expected of ["Run npm run check before opening a PR"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
