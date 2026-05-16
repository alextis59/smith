import { headingAnchor } from "./src/heading-anchor.js";
import assert from "node:assert/strict";
assert.equal(headingAnchor(" Runtime Config "), "#runtime-config");
assert.equal(headingAnchor("API: v2.4!"), "#api-v2-4");
