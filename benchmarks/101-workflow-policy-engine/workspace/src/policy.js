import { readFileSync } from "node:fs";

export function loadWorkflowConfig() {
  return JSON.parse(readFileSync(new URL("../config/workflows.json", import.meta.url), "utf8"));
}

export function resolvePolicy(event, config = loadWorkflowConfig()) {
  return {
    route: config.routes[event.type] ?? "triage",
    status: "ready",
    severity: "normal",
    requiredApprovals: 0,
    missingApprovals: 0,
    reasons: [],
    approvers: []
  };
}
