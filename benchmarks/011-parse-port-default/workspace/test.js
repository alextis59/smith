import { parsePort } from "./src/parse-port.js";
import assert from "node:assert/strict";
assert.equal(parsePort(undefined), 3000);
assert.equal(parsePort("0"), 0);
assert.equal(parsePort("8080"), 8080);
assert.throws(() => parsePort("abc"), /invalid port/);
assert.throws(() => parsePort("70000"), /invalid port/);
