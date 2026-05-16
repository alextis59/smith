import { envBool } from "./src/env-bool.js";
import assert from "node:assert/strict";
assert.equal(envBool("true"), true);
assert.equal(envBool("0"), false);
assert.equal(envBool("OFF"), false);
assert.equal(envBool("yes"), true);
