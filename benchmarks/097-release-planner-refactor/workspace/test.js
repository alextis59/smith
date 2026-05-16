import assert from "node:assert/strict";
import { planRelease } from "./src/release.js";
assert.deepEqual(planRelease([{version:"1.0.0", channel:"beta"},{version:"0.9.0", channel:"stable"}]), {stable:"0.9.0", beta:"1.0.0"});
