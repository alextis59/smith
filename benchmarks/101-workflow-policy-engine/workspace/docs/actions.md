# Action Contract

The engine emits action objects for decisions that can proceed:

- ready deployments schedule a deploy.
- deployments missing approvals request approval from configured approvers who have not already approved.
- incidents page the owning on-call team.
- billing failures notify finance with the account and severity.

Blocked and ignored decisions do not emit actions.
