import assert from "node:assert/strict";
import { loadPlugins } from "./src/plugins.js";
assert.deepEqual(loadPlugins([{id:"b"},{id:"a"}]).map((p)=>p.id), ["a","b"]); assert.throws(()=>loadPlugins([{id:"a"},{id:"a"}]), /duplicate/);
