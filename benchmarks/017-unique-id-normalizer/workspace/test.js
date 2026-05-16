import { normalizeId } from "./src/normalize-id.js";
import assert from "node:assert/strict";
assert.equal(normalizeId(" inv-42 "), "INV42");
assert.equal(normalizeId("cust_007"), "CUST007");
