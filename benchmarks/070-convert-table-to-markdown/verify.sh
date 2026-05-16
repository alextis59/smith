set -euo pipefail
test -f 'reports/table.md'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/table.md", "utf8"), "| Name | Role |\n| --- | --- |\n| Ada | Admin |\n| Grace | User |\n");
NODE
