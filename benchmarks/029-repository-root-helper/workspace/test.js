import assert from "node:assert/strict";
import { run } from "./src/index.js";
assert.equal(run({"name":"smith","command":"start","enabled":true}), "/repo");
