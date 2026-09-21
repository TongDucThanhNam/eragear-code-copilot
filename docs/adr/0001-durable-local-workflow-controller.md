# ADR 0001: Supervisos Is a Durable Local Workflow Controller

- Status: Accepted
- Date: 2026-08-18
- Decision owners: Product user and runtime architecture

## Context

Supervisos currently distributes decisions about progress, retry, capacity,
session recovery, completion, and user escalation across Supervisor loop,
orchestration, scheduler, recovery, worker-management, manager-session, and
quota services. Run and task status enums mix durable facts, desired state,
execution phases, resource availability, UI projections, and human decisions.

This makes crash recovery a second business flow, makes prompt delivery gaps
hard to reconcile safely, and allows a replaceable LLM/session to become an
implicit owner of workflow state. The resulting product requires the user to
babysit long-running Goals.

## Decision

Supervisos is a durable local controller that reconciles a versioned Goal
contract into Git changes with explicit evidence by scheduling ACP sessions
according to capability, provider capacity, workspace ownership, and human
authority.

- LLMs propose what to do and why.
- A deterministic Workflow Kernel owns when work runs, who may run it, state,
  retry, timers, idempotency, recovery, and decision boundaries.
- SQLite facts, events, and effect intents are execution truth.
- Obsidian is desired state, human knowledge, and a projection/report surface.
- ACP is an execution protocol. Sessions and prompts are replaceable runtime
  resources, not product Goals or canonical workflow state.
- Git, trusted verification, and explicit user acceptance provide completion
  evidence.

Run desired state, phase, and outcome are independent facts. WorkItem
dependencies, outcomes, active attempts, wake times, and blocking decisions are
facts. Statuses such as `waiting_capacity`, `queued`, `ready`, `blocked`,
`reviewing`, `integrating`, and `needs_user` are derived projections.

Every external effect is durably intended before execution. ACP prompt
delivery is at-least-once and may become uncertain; reconciliation inspects
session, transcript, workspace, Git, and verifier evidence before deciding
whether to continue or resend. We do not claim distributed exactly-once prompt
delivery.

## Consequences

Positive:

- Runtime and provider restarts become ordinary reconciliation.
- One provider or reasoning session can be unavailable without stopping
  already-approved independent work.
- User interruptions become explicit, scoped, explainable DecisionRequests.
- Completion is auditable from contract revision, PlanVersion, events, Git,
  and evidence.
- Existing ACP, quota, Git, verification, and UI adapters can be retained while
  authority moves behind new ports.

Costs and constraints:

- A transactional workflow journal/effect outbox and uncertain-effect recovery
  are required.
- Legacy status APIs need a temporary projection layer during migration.
- Capacity recovery remains provider-specific where ACP lacks authoritative
  quota reset metadata.
- Safe intra-repository parallel writes remain deferred until workspace and
  integration invariants are proven.

## Migration strategy

Do not rename or delete modules first. Introduce canonical facts, reducer,
reconciler, transactional effects, and compatibility projections. Route the
current orchestration facade through these primitives, then consolidate
capacity/agent/workspace boundaries and remove duplicate schedulers/recovery
flows after acceptance tests pass.

The detailed product contract, invariants, slices, and acceptance tests live in
`GOAL.md`.
