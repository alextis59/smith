set -euo pipefail
test -f 'docs/config.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("docs/config.md", "utf8");
for (const expected of ["danger_review = \"off|ask|llm\""]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
