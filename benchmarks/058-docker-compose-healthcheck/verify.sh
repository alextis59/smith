set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const text=fs.readFileSync("compose.yaml","utf8"); assert.match(text,/healthcheck:/); assert.match(text,/node", "healthcheck\.js"/);
NODE
