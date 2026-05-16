set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const text=fs.readFileSync(".github/workflows/test.yml","utf8"); assert.match(text,/node: \[20, 22\]/);
NODE
