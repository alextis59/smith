set -euo pipefail
test -f 'reports/debits.csv'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/debits.csv", "utf8"), "type,amount\ndebit,5\ndebit,3\n");
NODE
