import assert from "node:assert/strict";
import { clean } from "./src/clean.js";
assert.equal(clean("\u00a0Smith\u00a0"),"Smith");
