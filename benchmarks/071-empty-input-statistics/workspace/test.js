import assert from "node:assert/strict";
import { average } from "./src/stats.js";
assert.equal(average([]),0); assert.equal(average([2,4]),3);
