import assert from "node:assert/strict";
import { runTasks } from "./src/runner.js";
assert.deepEqual(runTasks([{name:"a",ms:5},{name:"b",ms:20}], 10), [{name:"a",status:"pass"},{name:"b",status:"timeout"}]);
