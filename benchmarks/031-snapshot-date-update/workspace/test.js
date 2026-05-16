import assert from "node:assert/strict";
import { currentValue } from "./src/behavior.js";
assert.equal(currentValue(), "2026-05-01");
