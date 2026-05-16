import assert from "node:assert/strict";
import { auditWorkspace } from "./src/audit.js";
assert.deepEqual(auditWorkspace(["Task.md","workspace"], ["Task.md","workspace","verify.sh"]), ["verify.sh"]);
