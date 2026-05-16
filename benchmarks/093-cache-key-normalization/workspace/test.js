import assert from "node:assert/strict";
import { cacheKey } from "./src/cache.js";
assert.equal(cacheKey("GET", "/Api", { b: 2, a: 1 }), "get:/api?a=1&b=2");
