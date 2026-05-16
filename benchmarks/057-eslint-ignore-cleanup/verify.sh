set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const text=fs.readFileSync(".eslintignore","utf8"); assert.ok(!text.includes("src/generated"));
NODE
