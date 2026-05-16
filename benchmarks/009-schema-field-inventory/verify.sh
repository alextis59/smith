set -euo pipefail
test -f 'summary.md'
node <<'NODE'
const fs = require("node:fs");
const text = fs.readFileSync("summary.md", "utf8");
for (const expected of ["Schema","customer_id","invoice_total","issued_at","line_items"]) {
  if (!text.includes(expected)) throw new Error(`missing expected content: ${expected}`);
}
for (const path of ["notes/source-a.md","notes/source-b.md"]) {
  if (!fs.existsSync(path)) throw new Error(`missing source file: ${path}`);
}
NODE
