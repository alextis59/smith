set -euo pipefail
node <<'NODE'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const text=fs.readFileSync(".smith/config.toml","utf8"); assert.match(text,/temperature = 0\.1/); assert.match(text,/reasoning_effort = "low"/);
NODE
