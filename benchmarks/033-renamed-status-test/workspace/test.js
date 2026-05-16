import assert from "node:assert/strict";
import { currentValue } from "./src/behavior.js";
assert.equal(currentValue(), "pending");
