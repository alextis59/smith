set -euo pipefail
test -f 'reports/users.json'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/users.json", "utf8"), "[\n  {\"name\":\"Ada\",\"role\":\"admin\"}\n]\n");
NODE
