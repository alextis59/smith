set -euo pipefail
test -f 'reports/sla.txt'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/sla.txt", "utf8"), "fast 1\nnormal 1\nslow 1\n");
NODE
