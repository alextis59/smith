import assert from "node:assert/strict";
import { splitRow } from "./src/table.js";
assert.deepEqual(splitRow("a\\|b|c"),["a|b","c"]);
