set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const text=fs.readFileSync(".editorconfig","utf8"); assert.match(text,/indent_size = 2/); assert.match(text,/insert_final_newline = true/);
NODE
