set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); assert.equal(pkg.scripts.lint,"node --check src/index.js");
NODE
