import assert from "node:assert/strict";
import { loadConfig } from "./src/loader.js";
assert.deepEqual(loadConfig({timeout:10},{timeout:20, mode:"fast"}), {config:{timeout:20, mode:"fast"}, errors:[]}); assert.equal(loadConfig({},{timeout:-1}).errors.length, 1);
