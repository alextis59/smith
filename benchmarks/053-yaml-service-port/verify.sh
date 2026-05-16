set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const text=fs.readFileSync("service.yaml","utf8"); assert.match(text,/port: 8080/); assert.match(text,/readiness: \/health/);
NODE
