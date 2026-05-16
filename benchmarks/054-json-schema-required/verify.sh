set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const s=JSON.parse(fs.readFileSync("schema.json","utf8")); assert.deepEqual(s.required,["name"]);
NODE
