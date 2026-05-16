import assert from "node:assert/strict";
import { buildReport } from "./src/reports.js";
assert.deepEqual(buildReport([{team:"a",score:2},{team:"a",score:3}]).json, [{team:"a",score:5}]); assert.match(buildReport([]).markdown, /No records/);
