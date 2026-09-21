# Prompt: Execute `GOAL.md`

This is the manual protocol that the Supervisos Workflow Kernel is gradually
making durable. Replace `{SLICE}` or `{STEP}` when you want to constrain a run.

## Execute the active Goal

```text
You are a coding agent executing the repository's GOAL.md.

Before acting, read GOAL.md, the applicable AGENTS.md files, and the relevant
code. GOAL.md is the product source of truth.

Execution rules:

1. Respect the Goal contract, locked decisions, change boundary, human
   authority, and non-goals.
2. Inspect current Git/workspace state before changing files. Preserve existing
   user work.
3. Work through the active implementation order without skipping required
   invariants.
4. After each coherent step, report changed files, verification evidence,
   blockers, and the explicit next action.
5. Run focused tests and type checks after each feature. Run broader checks in
   proportion to risk.
6. Do not claim completion from agent output alone. Map every acceptance
   criterion to passing machine evidence or an explicit user acceptance/waiver.
7. Evidence that is missing or uncertain means the work is not accepted.
8. Do not broaden architecture, dependencies, permissions, destructive
   actions, or the change boundary without an explicit user decision.
9. If interrupted, reconstruct state from the frozen Goal/Plan revision, Git,
   durable events/effects, verification evidence, and the last confirmed agent
   result. Never blindly replay an uncertain prompt.

Architecture rules:

- Business rules stay in packages/runtime.
- Domain code does not import application, transport, platform, or infra.
- Application services use ports for external effects.
- Electron main/preload remain lifecycle/native integration only.
- LLMs propose what/why; deterministic services own when/who/state/retry.
- WorkItem, TurnAttempt, AgentSession, CapacityLease, and DecisionRequest are
  distinct lifecycles.
- Every external workflow effect has a durable intent before execution.

Start with the first incomplete item in GOAL.md's Implementation order.

Before editing, report:

1. The objective and frozen scope you understand.
2. The current incomplete step and evidence used to identify it.
3. Any genuine decision boundary that prevents safe progress.
```

## Execute one slice or step

```text
Execute GOAL.md — {SLICE_OR_STEP}

Read GOAL.md and applicable AGENTS.md files first. Work only within the named
slice/step and its prerequisites.

1. Inspect the relevant current implementation and Git state.
2. Identify the canonical facts, ports, effects, and evidence for this step.
3. Implement the smallest coherent vertical slice.
4. Verify with focused tests, type checks, architecture checks, and patch
   hygiene appropriate to the risk.
5. Update GOAL_PROGRESS.md with exact files, commands/results, and remaining
   work.

Report changed files, evidence, blockers/decisions, and the next action.
```

## Audit completion

```text
Audit GOAL.md against the repository and runtime evidence.

For every required invariant, active-slice acceptance test, and explicit
acceptance criterion:

1. Locate the implementation and canonical owner.
2. Run or inspect the trusted verification evidence.
3. Mark PASS, FAIL, or PARTIAL.
4. For FAIL/PARTIAL, state the missing fact/effect/evidence and next action.

Also audit for duplicate scheduling/retry/recovery owners, direct legacy status
authority, prompt sends without durable intents, and completion paths based
only on agent claims.

Do not claim success for unverified criteria.
```

## Resume after interruption

```text
Resume GOAL.md execution from durable evidence.

1. Read the frozen Goal revision and approved PlanVersion, if present.
2. Inspect Git/workspace state, workflow events/effect intents, active or
   uncertain TurnAttempts, session capabilities, and verification evidence.
3. Identify the last confirmed effect and the explicit next action.
4. If a prompt/resume may have executed, reconcile it as uncertain; do not
   blindly resend.
5. Continue with the next safe effect inside the existing authority boundary.

Report the reconstructed state, evidence, action taken, and remaining work.
```
