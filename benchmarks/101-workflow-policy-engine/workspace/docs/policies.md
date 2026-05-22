# Workflow Policies

Deployment events use plan-specific approval thresholds:

- free plans require 1 approval.
- team plans require 3 approvals.
- enterprise plans require 10 approvals.

High-risk deployments are blocked unless the event has an emergency override. Billing failures are warning severity below 1000 and critical severity at 1000 or higher. Unknown events should be kept visible as ignored triage decisions.
