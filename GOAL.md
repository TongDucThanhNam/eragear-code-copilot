# Supervisos Durable Workflow Controller

## Objective

Turn Supervisos into a durable local controller that reconciles a versioned
Goal contract into reviewable Git changes with explicit evidence. The
controller schedules ACP sessions according to capability, provider capacity,
workspace ownership, and human authority.

The product north-star is:

> Manual interventions per accepted Goal.

Long execution time is acceptable. Closing Desktop, restarting the runtime,
losing an agent process, or exhausting one provider's quota must not lose the
workflow position. The controller must know what is durable, why progress
stopped, when it may retry, and whether a user decision is genuinely required.

The governing architecture decision is recorded in
`docs/adr/0001-durable-local-workflow-controller.md`.

## Core decision

LLMs decide **what and why**. Deterministic runtime services decide **when,
who, state, retry, authority, and recovery**.

- The user owns strategy, architecture, product decisions, authority, and
  final semantic acceptance.
- Supervisor Reasoning proposes plans, replans, decisions, and summaries.
- The Workflow Kernel owns canonical state, durable events, timers, effect
  intents, idempotency, retry, and recovery.
- The Capacity Broker owns provider/account observations, eligibility,
  cooldowns, probes, and leases.
- Agent Runtime owns ACP processes, capability snapshots, sessions, and prompt
  turns.
- Workspace owns Git snapshots, write ownership, checkpoints, verification,
  integration, and evidence.
- SQLite is execution truth. Obsidian is desired state, human knowledge, and a
  projection/report surface.

Electron main/preload remain thin. Business rules stay in `packages/runtime`.
Renderer access to privileged operations remains behind preload/contextBridge
IPC with context isolation enabled and renderer Node integration disabled.

## Target architecture

```text
User / Obsidian / Desktop / Mobile / Telegram
             Goal, constraints, approvals
                         |
                         v
             Contract Snapshot + Revision
                         |
                         v
┌───────────────────────────────────────────────────────────┐
│ Durable Workflow Kernel                                  │
│ SQLite facts + events + effect outbox + durable wakeups   │
│ RunReconciler + DecisionPolicy + GlobalDispatcher         │
└───────────────────┬───────────────────────┬───────────────┘
                    |                       |
                    | typed proposal        | capacity lease
                    v                       v
        SupervisorReasonerPort       CapacityBroker
        ACP / AI SDK / local model   provider/account facts
                    └───────────┬───────────┘
                                v
                     AgentExecutionController
                  ACP new / resume / load / prompt
                                |
                   Git workspace + verifier
                                |
                         Evidence records
                                |
                      Obsidian projections
```

Supervisor Reasoning is a replaceable adapter. A manager ACP session may be
used, but it never owns canonical workflow state. Approved WorkItems may
continue while reasoning capacity is unavailable; only planning, replanning,
or a new semantic decision waits for reasoning capacity.

## Bounded contexts and lifecycles

Keep these lifecycles separate:

```text
Product:  GoalContract -> GoalRevision -> PlanVersion -> WorkItem
Agent:    WorkItem -> TurnAttempt -> AgentSession
Capacity: AgentIdentity -> CapacityObservation -> CapacityLease
Human:    DecisionRequest -> DecisionResolution
```

An ACP session, prompt turn, and WorkItem are different entities. A WorkItem
survives multiple attempts and sessions. An AgentSession may serve multiple
turns. Quota is an observation on an identity/provider, not a WorkItem state.
An unresolved DecisionRequest derives `needs_user`; it is not a run phase.

### Run facts

```ts
type Run = {
  desiredState: "running" | "paused" | "cancelled";
  phase: "planning" | "executing" | "finalizing" | "finished";
  outcome?: "succeeded" | "failed" | "cancelled";
};
```

### WorkItem facts

```ts
type WorkItem = {
  dependencies: string[];
  outcome?: "succeeded" | "failed" | "cancelled";
  notBefore?: string;
  activeAttemptId?: string;
  blockingDecisionId?: string;
};
```

`paused` is desired state. `waiting_capacity`, `queued`, `blocked`, `ready`,
`reviewing`, `integrating`, and `needs_user` are projections from facts such as
dependencies, active activities, capacity leases, effect intents, wake times,
and open decisions. Compatibility APIs may expose legacy status strings during
migration, but services must not treat them as canonical state.

## Workflow Kernel

The kernel has three primary primitives:

```ts
reduce(previousFacts, durableEvent): nextFacts
decide(currentFacts, now): EffectIntent[]
execute(effectIntent): durableResultEvent
```

The reducer is pure and performs no AI, ACP, filesystem, Git, network, or
clock IO. The reconciler is deterministic and produces typed intents. Effect
executors call existing ports/adapters and append result events.

Every external effect has a durable intent before execution:

```text
transaction {
  compare-and-swap aggregate revision
  append durable event
  reduce/persist facts
  enqueue effect intents
}
        |
        v
claim and execute due effects
        |
        v
append EffectSucceeded / EffectFailed / EffectUncertain
```

Startup recovery is ordinary reconciliation:

1. Recover stale `started` effects; prompt/resume effects become `uncertain`,
   never silently `pending`.
2. Drain pending effect intents.
3. Reconcile non-terminal runs.
4. Reconcile active or uncertain attempts using session, transcript, Git, and
   verification evidence.
5. Restore durable wakeups and expire stale capacity leases.

Only three scheduling owners remain:

- `RunReconciler` advances one run from facts.
- `GlobalDispatcher` selects a ready WorkItem, compatible AgentProfile,
  eligible AgentIdentity, and available Workspace.
- `EffectExecutor` performs external effects and records outcomes.

GlobalDispatcher never plans or replans.

## Prompt delivery and uncertain effects

Do not claim exactly-once ACP prompt delivery. The workflow outbox provides
at-least-once effect execution, while reconciliation provides effectively-once
behavior where evidence permits it.

Before a prompt is sent, persist the TurnAttempt, prompt hash, session binding,
workspace snapshot, and `started` effect. If the runtime dies after send but
before acknowledgement, mark the effect and attempt `uncertain` on recovery.
Inspect the live process/session, transcript updates, Git diff, workspace, and
verification state. Resend only with evidence that the prompt was not
executed. Otherwise send a bounded continuation asking the agent to inspect
canonical current state; never blindly replay the original task.

## Agent session recovery

Use negotiated ACP capabilities in this order:

1. `session/resume` when advertised.
2. `session/load` when advertised.
3. `session/new` with a frozen handoff bundle.

The handoff bundle is built from canonical facts and evidence, not manager
memory. It includes Goal and Plan revisions, WorkItem contract, change
boundary, criteria, Git commit/diff, changed files, verification output,
outstanding failures, last confirmed agent result, and the explicit next
action.

ACP long-running session goals are worker projections. They are not the
product Goal.

## Capacity

`capacity` is one bounded context covering provider quota, ACP capacity,
agent-profile capacity, provider health, cooldowns, probes, and leases.

Classify failures at least as:

```text
burst_rate_limit
subscription_exhausted
auth_required
provider_unavailable
context_exhausted
transport_lost
agent_crashed
fatal
unknown
```

Capacity observations record state, next eligibility when known, confidence,
evidence, and observation time. Do not invent precise remaining quota when the
provider does not expose it. The scheduling contract needs to answer whether
an identity can run, when to probe again, and whether fallback is authorized.

- Burst limits use exponential backoff with jitter.
- Subscription exhaustion uses authoritative reset evidence when present,
  otherwise bounded probes.
- Authentication creates a blocking DecisionRequest.
- Provider fallback occurs only when the Goal contract permits it.
- Context exhaustion creates a new session with a handoff bundle.
- Transport/process failures attempt capability-aware recovery.
- Unknown failures have a small retry budget, then escalate.

Reasoning and worker execution use separate capacity priority classes.

## Goal contracts and evidence

Obsidian follows a local GitOps model:

```text
Obsidian       desired state + human knowledge
SQLite/events observed execution state
Reconciler     controller
ACP agents     workers
Git/tests      evidence
```

User-owned Goal notes and generated Plan/Decision/Run projections have
separate ownership. The controller never rewrites the body of an active Goal
note. A note edit creates an immutable GoalRevision with a content hash and
does not mutate an active run. Policy or the user chooses to continue the old
revision, replan to the new revision, or cancel.

Every PlanVersion records the Goal revision/hash, repository snapshot,
referenced-note hashes, planner profile, and creation time. Workers receive a
bounded ContextBundle, not the whole vault.

Keep these contract axes separate:

- Change boundary: where an agent may modify.
- Acceptance criteria: what must ultimately be true.
- Trusted verification: which evidence can prove a criterion.

Each WorkItem references criterion IDs. A Goal succeeds only when every
criterion has passing machine evidence or an explicit user acceptance/waiver.
An agent saying `done` is never completion evidence.

## Supervisor Reasoning

Reasoners return typed proposals only:

```ts
interface SupervisorReasonerPort {
  proposePlan(input: PlanningSnapshot): Promise<PlanProposal>;
  proposeReplan(input: ReplanningSnapshot): Promise<ReplanProposal>;
  draftDecision(input: DecisionSnapshot): Promise<DecisionDraft>;
  summarizeRun(input: RunEvidenceSnapshot): Promise<RunSummary>;
}
```

A deterministic validator checks schemas, graph cycles, criterion coverage,
agent profiles, trusted commands, change boundaries, write conflicts, policy
caps, and locked architecture decisions before materializing a proposal. The
reasoner never calls repository mutation methods or starts sessions directly.

## Human authority

The initial product mode is `managed`: the user approves one PlanVersion, then
the controller runs until completion or an explicit decision boundary.

Create DecisionRequests for architecture/stack changes, significant dependency
changes, migrations, destructive actions, new permissions, boundary expansion,
semantic acceptance without executable evidence, exhausted retry budgets, and
final integration when policy requires it.

A decision contains the question, blocking reason, evidence, options,
recommendation, consequences, affected WorkItems, and Plan revision. It blocks
only the affected WorkItems/run. Unrelated projects continue. Desktop,
Obsidian, mobile, and Telegram are adapters for the same durable decisions;
they contain no orchestration business rules.

## Workspace and concurrency

Ship multi-project concurrency before intra-project parallel writes:

- Default to one active writer per Git repository.
- Run independent projects concurrently across eligible identities.
- Use a WorkItem worktree/branch where isolation is required.
- Parallelize within one repository only for independent dependencies with
  disjoint change boundaries.
- Serialize integration and rerun verification after integration.
- Treat merge conflict as an integration failure, not a worker failure.

Preserve existing checkpoint, permission, project-root sandbox, and Git safety
rules. Approval never authorizes push, deployment, arbitrary filesystem paths,
or bypassing hooks/permission gates.

## Repository boundaries

Migrate by extraction and compatibility projections, then delete old owners:

- `supervisor` becomes `supervisor-reasoning`: chat, planning/replanning,
  decision drafting, bounded context/prompt building, intelligence, research.
- `supervisor-orchestration` becomes `workflow`: contracts, facts, events,
  reducer, reconciler, decisions, effect outbox, dispatcher, and projections.
- `quota` and capacity coordinators become `capacity`.
- ACP worker/process/session/turn handling becomes `agent-runtime`.
- Git workspaces, checkpoints, verifier, evidence, locks, and integration become
  `workspace`.
- Obsidian and Telegram become idempotent input/projection integrations.

Do not perform a big-bang directory rename. First move authority to the new
primitive, keep existing tRPC/UI names as compatibility facades, verify, then
remove duplicate brains and obsolete statuses.

## Delivery slices

### Slice 1 — Durable babysitter

```text
Goal/Task
-> one WorkItem
-> one ACP AgentSession
-> durable prompt observation
-> failure/capacity classification
-> scheduled recovery/continuation
-> trusted verification
-> evidence report
```

No AI decomposition is required. This slice must survive process/runtime
restart and provider exhaustion without user babysitting.

### Slice 2 — Managed sequential Goal

Add typed reasoning proposals, one plan approval, sequential WorkItems,
criterion/evidence traceability, Decision Inbox, and bounded replanning.

### Slice 3 — Multi-project Capacity Broker

Add a global ready queue, one writer per project, provider/account leases,
weighted fairness, circuit breakers, failover policy, and separate reasoning /
worker priority classes.

### Slice 4 — Safe parallelism

Add dependency DAG execution, disjoint change boundaries, worktrees, serialized
integration, post-merge verification, steering, and bounded replan.

Telegram orchestration, advanced planners, power policy refinements, and
long-lived manager-session conveniences must not block Slice 1.

## Required invariants

1. Canonical workflow state never exists only in a chat transcript.
2. Agent completion claims do not complete a WorkItem without evidence or user
   acceptance.
3. A WorkItem has at most one active TurnAttempt.
4. A workspace has at most one active writer.
5. Every external effect has a durable intent before execution.
6. A crash after dispatch but before acknowledgement becomes `uncertain`; the
   controller does not blindly resend.
7. A Goal edit creates a new revision and does not silently alter an active
   contract.
8. A blocking decision does not stop unrelated projects.
9. Capacity exhaustion preserves session binding and current evidence.
10. Goal revision, PlanVersion, events, Git, and evidence can reconstruct a
    complete run.

## Acceptance tests and metrics

Acceptance must cover:

- Kill runtime while an agent edits; restart and reconcile the same work.
- Capacity reset with an ETA wakes and continues automatically.
- Capacity exhaustion without an ETA uses bounded probes without a retry
  storm.
- Agent claims success while tests fail; WorkItem remains incomplete.
- Edit an Obsidian Goal during a run; the run keeps its frozen revision.
- Two projects share a provider; leases never exceed configured capacity.
- Adapter lacks resume/load; a new session receives the frozen handoff bundle.
- Crash after prompt send but before acknowledgement; recovery inspects
  evidence and never blindly resends.

Primary metric: `manualInterventionsPerAcceptedGoal`.

Supporting metrics:

- `automaticRecoveryRate`
- `unverifiedCompletionCount`
- `duplicateOrUncertainDispatchCount`
- `timeBlockedWithoutNotification`

## Implementation order

1. Introduce orthogonal facts, pure reducer/projections, durable workflow
   events/effect intents, and uncertain prompt dispatch while preserving
   compatibility APIs.
2. Route startup and run scheduling through RunReconciler and EffectExecutor;
   make recovery ordinary reconciliation.
3. Extract SupervisorReasonerPort and validate typed proposals; remove manager
   session state as workflow authority.
4. Consolidate quota/capacity ownership and move lease selection into
   GlobalDispatcher.
5. Add GoalRevision/PlanVersion/criterion/evidence contracts and bounded
   Obsidian ingestion/projections.
6. Rename boundaries and delete compatibility statuses/services only after
   production paths and acceptance tests use the new owners.

Update `GOAL_PROGRESS.md` after every major phase with changed files, exact
verification commands, results, and remaining work.
