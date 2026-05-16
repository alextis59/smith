import { splitCsvLine } from "./src/split-csv-line.js";
import assert from "node:assert/strict";
assert.deepEqual(splitCsvLine("a,b,c"), ["a", "b", "c"]);
assert.deepEqual(splitCsvLine("a,\"b,c\",d"), ["a", "b,c", "d"]);
