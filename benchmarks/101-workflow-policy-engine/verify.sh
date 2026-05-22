set -euo pipefail
node test.js
find src -name '*.js' -print0 | xargs -0 -n1 node --check
grep -q "## Verification" README.md
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { compileWorkflow } from "./src/workflow.js";

const result = compileWorkflow([
  { id: "enterprise-emergency", type: "deploy.requested", plan: "enterprise", risk: "high", emergency: true, approvals: ["ops-lead", "security"] },
  { id: "billing-warning", type: "billing.failed", account: "acct_2", amount: 999 },
  { id: "unknown-1", type: "data.exported" }
]);
const decisions = new Map(result.decisions.map((decision) => [decision.id, decision]));
assert.equal(decisions.get("enterprise-emergency").status, "pending");
assert.equal(decisions.get("enterprise-emergency").requiredApprovals, 10);
assert.equal(decisions.get("enterprise-emergency").missingApprovals, 8);
assert.deepEqual(decisions.get("enterprise-emergency").actions, [
  { type: "request_approval", route: "ops", approvers: ["compliance", "director"] }
]);
assert.equal(decisions.get("billing-warning").severity, "warning");
assert.equal(decisions.get("unknown-1").route, "triage");
assert.equal(decisions.get("unknown-1").status, "ignored");
assert.deepEqual(decisions.get("unknown-1").actions, []);
assert.deepEqual(result.audit.byStatus, { pending: 1, ready: 1, ignored: 1 });
NODE
