set -euo pipefail
test -f 'reports/customers.json'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/customers.json", "utf8"), "[\n  {\"id\":1,\"email\":\"a@example.com\"},\n  {\"id\":2,\"email\":\"b@example.com\"}\n]\n");
NODE
