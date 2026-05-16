import assert from "node:assert/strict";
import { ext } from "./src/ext.js";
assert.equal(ext(".env"),""); assert.equal(ext("a/b.txt"),".txt");
