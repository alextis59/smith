import assert from "node:assert/strict";
import { overlaps } from "./src/range.js";
assert.equal(overlaps({start:1,end:3},{start:3,end:4}),true);
