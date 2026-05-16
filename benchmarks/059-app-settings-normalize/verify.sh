set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const s=JSON.parse(fs.readFileSync("settings.json","utf8")); assert.equal(s.retries,3); assert.equal(s.telemetry,false);
NODE
