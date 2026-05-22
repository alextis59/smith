import { summarizeAudit } from "./audit.js";

export function compileWorkflow(events, options = {}) {
  return {
    generatedAt: options.now ?? null,
    decisions: events,
    audit: summarizeAudit(events)
  };
}
