import { slugify } from "./src/slugify.js";
import assert from "node:assert/strict";
assert.equal(slugify(" Hello, Smith! "), "hello-smith");
assert.equal(slugify("Two   Spaces"), "two-spaces");
assert.equal(slugify("v2.4 release"), "v2-4-release");
