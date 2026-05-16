import assert from "node:assert/strict";
import { resolveCommand } from "./src/router.js";
assert.deepEqual(resolveCommand(["start", "s", "missing"]), [{command:"start"},{command:"start"},{error:"unknown command: missing"}]);
