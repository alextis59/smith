set -euo pipefail
test -f 'reports/notes.txt'
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(fs.readFileSync("reports/notes.txt", "utf8"), "2026-05-01 Started\n2026-05-16 Added API\n");
NODE
