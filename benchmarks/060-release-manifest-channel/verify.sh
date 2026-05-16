set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const s=JSON.parse(fs.readFileSync("release.json","utf8")); assert.equal(s.channel,"stable");
NODE
