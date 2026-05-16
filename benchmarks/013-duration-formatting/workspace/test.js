import { formatDuration } from "./src/format-duration.js";
import assert from "node:assert/strict";
assert.equal(formatDuration(250), "250ms");
assert.equal(formatDuration(1500), "1s");
assert.equal(formatDuration(65000), "1m 5s");
