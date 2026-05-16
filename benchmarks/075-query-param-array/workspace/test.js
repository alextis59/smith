import assert from "node:assert/strict";
import { toQuery } from "./src/query.js";
assert.equal(toQuery({tag:["a","b"], q:"x y"}),"tag=a&tag=b&q=x%20y");
