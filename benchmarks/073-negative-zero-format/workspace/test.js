import assert from "node:assert/strict";
import { formatNumber } from "./src/format-number.js";
assert.equal(formatNumber(-0),"0"); assert.equal(formatNumber(3),"3");
