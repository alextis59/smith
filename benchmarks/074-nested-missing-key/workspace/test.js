import assert from "node:assert/strict";
import { get } from "./src/get.js";
assert.equal(get({a:{}}, "a.b.c"), undefined);
