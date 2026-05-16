import assert from "node:assert/strict";
import { parseLines } from "./src/json-lines.js";
assert.deepEqual(parseLines('{"a":1}\n'),[{a:1}]);
