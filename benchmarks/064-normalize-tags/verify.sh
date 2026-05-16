set -euo pipefail
test -f 'reports/tags.txt'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/tags.txt", "utf8"), "alpha\nbeta\n");
NODE
