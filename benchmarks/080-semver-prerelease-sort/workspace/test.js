import assert from "node:assert/strict";
import { sortVersions } from "./src/semver.js";
assert.deepEqual(sortVersions(["1.0.10","1.0.2","1.0.2-beta"]),["1.0.2","1.0.2-beta","1.0.10"]);
