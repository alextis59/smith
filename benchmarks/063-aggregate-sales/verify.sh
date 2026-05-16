set -euo pipefail
test -f 'reports/sales-total.txt'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/sales-total.txt", "utf8"), "east 7\nwest 25\n");
NODE
