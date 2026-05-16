set -euo pipefail
test -f 'docs/migration.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("docs/migration.md", "utf8");
for (const expected of ["Replace agent with smith in command examples"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of []) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
