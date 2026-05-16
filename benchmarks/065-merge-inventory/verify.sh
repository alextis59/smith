set -euo pipefail
test -f 'reports/inventory.json'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/inventory.json", "utf8"), "[\n  {\"sku\":\"a\",\"qty\":5},\n  {\"sku\":\"b\",\"qty\":4}\n]\n");
NODE
