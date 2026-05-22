import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileWorkflow } from "./src/workflow.js";

const events = JSON.parse(readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"));
const result = compileWorkflow(events, { now: "2026-05-23T12:00:00Z" });
const decisions = new Map(result.decisions.map((decision) => [decision.id, decision]));

assert.equal(result.generatedAt, "2026-05-23T12:00:00Z");
assert.deepEqual(decisions.get("deploy-high"), {
  id: "deploy-high",
  type: "deploy.requested",
  route: "ops",
  status: "blocked",
  severity: "critical",
  requiredApprovals: 3,
  missingApprovals: 2,
  reasons: ["high risk deployment requires emergency override"],
  actions: []
});
assert.deepEqual(decisions.get("deploy-ready").actions, [{ type: "schedule_deploy", route: "ops" }]);
assert.deepEqual(decisions.get("incident-1").actions, [{ type: "page_oncall", route: "incident", team: "payments" }]);
assert.deepEqual(decisions.get("billing-1").actions, [
  { type: "notify_finance", route: "finance", account: "acct_1", severity: "critical" }
]);
assert.deepEqual(result.audit, {
  total: 4,
  actionCount: 3,
  byStatus: { blocked: 1, ready: 3 },
  byRoute: { ops: 2, incident: 1, finance: 1 }
});
