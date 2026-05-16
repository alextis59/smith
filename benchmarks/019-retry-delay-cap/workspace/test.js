import { retryDelay } from "./src/retry-delay.js";
import assert from "node:assert/strict";
assert.equal(retryDelay(0), 100);
assert.equal(retryDelay(3), 800);
assert.equal(retryDelay(20), 5000);
