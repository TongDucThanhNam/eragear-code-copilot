export type WorkflowDesiredState = "running" | "paused" | "cancelled";

export type WorkflowPhase =
  | "planning"
  | "executing"
  | "finalizing"
  | "finished";

export type WorkflowOutcome = "succeeded" | "failed" | "cancelled";

export interface WorkflowPlanFacts {
  goalRevisionId: string;
  status: "missing" | "requested" | "proposed" | "approved";
  planVersion?: number;
  blockingDecisionId?: string;
}

export interface WorkflowVerificationFacts {
  verificationId: string;
  status:
    | "not_required"
    | "not_started"
    | "running"
    | "passed"
    | "failed"
    | "accepted";
  evidenceRefs: string[];
  blockingDecisionId?: string;
}

export type WorkflowWorkItemOutcome =
  | {
      status: "succeeded";
      acceptance: "pending" | "machine_verified" | "user_accepted" | "waived";
      evidenceRefs: string[];
    }
  | {
      status: "failed" | "cancelled";
      evidenceRefs: string[];
    };

export interface WorkflowAgentSessionBinding {
  chatId: string;
  agentSessionId?: string;
}

export interface WorkflowActiveAttemptFacts {
  attemptId: string;
  binding: WorkflowAgentSessionBinding;
  status:
    | "starting"
    | "running"
    | "waiting_capacity"
    | "uncertain"
    | "completed";
  retryAt?: string;
  uncertaintyId?: string;
}

export interface WorkflowDispatchFacts {
  dispatchId: string;
  state: "capacity_requested" | "leased" | "start_requested";
  retryAt?: string;
}

export interface WorkflowCapacityLeaseFacts {
  leaseId: string;
  agentIdentityId: string;
  expiresAt: string;
}

export interface WorkflowIntegrationFacts {
  integrationId: string;
  workspaceId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  blockingDecisionId?: string;
}

export interface WorkflowWorkItemSnapshot {
  workItemId: string;
  dependencies: string[];
  outcome?: WorkflowWorkItemOutcome;
  notBefore?: string;
  activeAttempt?: WorkflowActiveAttemptFacts;
  blockingDecisionId?: string;
  dispatch?: WorkflowDispatchFacts;
  capacityLease?: WorkflowCapacityLeaseFacts;
  assignedAgentIdentityId?: string;
  verification?: WorkflowVerificationFacts;
  integration?: WorkflowIntegrationFacts;
}

export interface RunReconcilerSnapshot {
  runId: string;
  desiredState: WorkflowDesiredState;
  phase: WorkflowPhase;
  outcome?: WorkflowOutcome;
  plan: WorkflowPlanFacts;
  finalVerification: WorkflowVerificationFacts;
  workItems: WorkflowWorkItemSnapshot[];
  maxParallel: number;
  occupiedEffectDedupeKeys: string[];
}

interface EffectIntentBase {
  runId: string;
  dedupeKey: string;
}

export type WorkflowEffectIntent =
  | (EffectIntentBase & {
      type: "request_plan";
      goalRevisionId: string;
    })
  | (EffectIntentBase & {
      type: "request_capacity";
      workItemId: string;
      dispatchId?: string;
      assignedAgentIdentityId?: string;
    })
  | (EffectIntentBase & {
      type: "start_turn";
      workItemId: string;
      dispatchId: string;
      leaseId: string;
      agentIdentityId: string;
    })
  | (EffectIntentBase & {
      type: "resume_session";
      workItemId: string;
      attemptId: string;
      binding: WorkflowAgentSessionBinding;
    })
  | (EffectIntentBase & {
      type: "inspect_uncertain_turn";
      workItemId: string;
      attemptId: string;
      binding: WorkflowAgentSessionBinding;
    })
  | (EffectIntentBase & {
      type: "run_verification";
      scope: "run" | "work_item";
      verificationId: string;
      workItemId?: string;
    })
  | (EffectIntentBase & {
      type: "request_decision";
      decisionId: string;
      workItemId?: string;
    })
  | (EffectIntentBase & {
      type: "schedule_wakeup";
      at: string;
    })
  | (EffectIntentBase & {
      type: "integrate_workspace";
      workItemId: string;
      attemptId: string;
      integrationId: string;
      workspaceId: string;
    });

export type WorkflowWorkItemUiStatus =
  | "ready"
  | "blocked"
  | "scheduled"
  | "queued"
  | "running"
  | "waiting_capacity"
  | "dispatch_uncertain"
  | "integrating"
  | "verifying"
  | "needs_user"
  | "completed"
  | "failed"
  | "cancelled";

export interface DerivedWorkflowWorkItemState {
  workItemId: string;
  uiStatus: WorkflowWorkItemUiStatus;
  dependenciesSucceeded: boolean;
  needsUser: boolean;
  ready: boolean;
  running: boolean;
  waitingCapacity: boolean;
}

export interface RunReconcilerDecision {
  effects: WorkflowEffectIntent[];
  workItems: DerivedWorkflowWorkItemState[];
  activeCount: number;
  availableParallelism: number;
  earliestWakeupAt?: string;
  readyForFinalization: boolean;
  completionEligible: boolean;
}

interface ReconcileContext {
  snapshot: RunReconcilerSnapshot;
  nowMs: number;
  workItemsById: Map<string, WorkflowWorkItemSnapshot>;
  effects: WorkflowEffectIntent[];
  occupiedDedupeKeys: Set<string>;
  wakeups: Map<string, number>;
  remainingParallelism: number;
}

export class RunReconciler {
  decide(snapshot: RunReconcilerSnapshot, now: string): RunReconcilerDecision {
    return decideRun(snapshot, now);
  }
}

export function decideRun(
  snapshot: RunReconcilerSnapshot,
  now: string
): RunReconcilerDecision {
  const nowMs = parseTimestamp(now, "now");
  const workItems = deriveWorkItemStates(snapshot, now);
  const activeCount = countActiveSlots(snapshot.workItems);
  const context: ReconcileContext = {
    snapshot,
    nowMs,
    workItemsById: new Map(
      snapshot.workItems.map((workItem) => [workItem.workItemId, workItem])
    ),
    effects: [],
    occupiedDedupeKeys: new Set(snapshot.occupiedEffectDedupeKeys),
    wakeups: new Map(),
    remainingParallelism: Math.max(
      0,
      Math.trunc(snapshot.maxParallel) - activeCount
    ),
  };

  if (isInactiveRun(snapshot)) {
    return buildDecision(context, workItems, activeCount, false, false);
  }

  reconcilePlan(context);
  if (snapshot.plan.status !== "approved") {
    return buildDecision(context, workItems, activeCount, false, false);
  }

  const readyForFinalization =
    snapshot.workItems.length > 0 &&
    snapshot.workItems.every((workItem) =>
      isAcceptedSuccessfulWorkItem(workItem)
    );

  if (snapshot.phase === "executing" && !readyForFinalization) {
    reconcileWorkItems(context);
  }

  const completionEligible =
    snapshot.phase === "finalizing" &&
    readyForFinalization &&
    isFinalVerificationAccepted(snapshot.finalVerification);

  if (snapshot.phase === "finalizing" && readyForFinalization) {
    reconcileFinalVerification(context);
  }

  scheduleEarliestWakeup(context);
  return buildDecision(
    context,
    workItems,
    activeCount,
    readyForFinalization,
    completionEligible
  );
}

export function deriveWorkItemStates(
  snapshot: RunReconcilerSnapshot,
  now: string
): DerivedWorkflowWorkItemState[] {
  const nowMs = parseTimestamp(now, "now");
  const workItemsById = new Map(
    snapshot.workItems.map((workItem) => [workItem.workItemId, workItem])
  );
  return [...snapshot.workItems]
    .sort(compareWorkItems)
    .map((workItem) => deriveWorkItemState(workItem, workItemsById, nowMs));
}

function reconcilePlan(context: ReconcileContext): void {
  const { plan, phase, runId } = context.snapshot;
  if (phase === "planning" && plan.status === "missing") {
    addEffect(context, {
      type: "request_plan",
      runId,
      goalRevisionId: plan.goalRevisionId,
      dedupeKey: effectKey(runId, "request_plan", plan.goalRevisionId),
    });
  }
  if (plan.blockingDecisionId) {
    addDecisionEffect(context, plan.blockingDecisionId);
  }
}

function reconcileWorkItems(context: ReconcileContext): void {
  for (const workItem of [...context.snapshot.workItems].sort(
    compareWorkItems
  )) {
    reconcileWorkItem(context, workItem);
  }
}

function reconcileWorkItem(
  context: ReconcileContext,
  workItem: WorkflowWorkItemSnapshot
): void {
  if (
    workItem.outcome?.status === "failed" ||
    workItem.outcome?.status === "cancelled"
  ) {
    return;
  }
  if (isAcceptedSuccessfulWorkItem(workItem)) {
    return;
  }

  const blockingDecisionId = getBlockingDecisionId(workItem);
  if (blockingDecisionId) {
    addDecisionEffect(context, blockingDecisionId, workItem.workItemId);
    return;
  }

  if (reconcileAttempt(context, workItem)) {
    return;
  }
  if (reconcileIntegrationOrVerification(context, workItem)) {
    return;
  }
  if (!dependenciesSucceeded(workItem, context.workItemsById)) {
    return;
  }
  if (isFuture(workItem.notBefore, context.nowMs)) {
    addWakeup(context, workItem.notBefore as string);
    return;
  }
  reconcileDispatch(context, workItem);
}

function reconcileAttempt(
  context: ReconcileContext,
  workItem: WorkflowWorkItemSnapshot
): boolean {
  const attempt = workItem.activeAttempt;
  if (!attempt) {
    return false;
  }
  if (attempt.status === "uncertain") {
    addEffect(context, {
      type: "inspect_uncertain_turn",
      runId: context.snapshot.runId,
      workItemId: workItem.workItemId,
      attemptId: attempt.attemptId,
      binding: attempt.binding,
      dedupeKey: effectKey(
        context.snapshot.runId,
        "inspect_uncertain_turn",
        workItem.workItemId,
        attempt.attemptId,
        attempt.uncertaintyId ?? "current"
      ),
    });
    return true;
  }
  if (attempt.status === "waiting_capacity") {
    reconcileWaitingAttempt(context, workItem, attempt);
    return true;
  }
  return attempt.status === "starting" || attempt.status === "running";
}

function reconcileWaitingAttempt(
  context: ReconcileContext,
  workItem: WorkflowWorkItemSnapshot,
  attempt: WorkflowActiveAttemptFacts
): void {
  if (isFuture(attempt.retryAt, context.nowMs)) {
    addWakeup(context, attempt.retryAt as string);
    return;
  }
  const retryToken = attempt.retryAt ?? "due";
  const dedupeKey = effectKey(
    context.snapshot.runId,
    "resume_session",
    workItem.workItemId,
    attempt.attemptId,
    retryToken
  );
  if (context.occupiedDedupeKeys.has(dedupeKey)) {
    return;
  }
  if (!reserveParallelSlot(context)) {
    return;
  }
  addEffect(context, {
    type: "resume_session",
    runId: context.snapshot.runId,
    workItemId: workItem.workItemId,
    attemptId: attempt.attemptId,
    binding: attempt.binding,
    dedupeKey,
  });
}

function reconcileIntegrationOrVerification(
  context: ReconcileContext,
  workItem: WorkflowWorkItemSnapshot
): boolean {
  const integration = workItem.integration;
  if (integration?.status === "pending") {
    const attempt = workItem.activeAttempt;
    if (attempt?.status === "completed") {
      addEffect(context, {
        type: "integrate_workspace",
        runId: context.snapshot.runId,
        workItemId: workItem.workItemId,
        attemptId: attempt.attemptId,
        integrationId: integration.integrationId,
        workspaceId: integration.workspaceId,
        dedupeKey: effectKey(
          context.snapshot.runId,
          "integrate_workspace",
          workItem.workItemId,
          attempt.attemptId,
          integration.integrationId
        ),
      });
    }
    return true;
  }
  if (integration?.status === "running" || integration?.status === "failed") {
    return true;
  }
  const verification = workItem.verification;
  if (
    verification?.status === "not_started" &&
    (workItem.activeAttempt?.status === "completed" ||
      workItem.outcome?.status === "succeeded")
  ) {
    addEffect(context, {
      type: "run_verification",
      scope: "work_item",
      runId: context.snapshot.runId,
      workItemId: workItem.workItemId,
      verificationId: verification.verificationId,
      dedupeKey: effectKey(
        context.snapshot.runId,
        "run_verification",
        workItem.workItemId,
        verification.verificationId
      ),
    });
    return true;
  }
  return Boolean(
    workItem.activeAttempt?.status === "completed" ||
      workItem.outcome?.status === "succeeded"
  );
}

function reconcileDispatch(
  context: ReconcileContext,
  workItem: WorkflowWorkItemSnapshot
): void {
  const dispatch = workItem.dispatch;
  const lease = workItem.capacityLease;
  if (dispatch?.state === "start_requested") {
    return;
  }
  if (dispatch?.state === "capacity_requested") {
    if (isFuture(dispatch.retryAt, context.nowMs)) {
      addWakeup(context, dispatch.retryAt as string);
      return;
    }
    addCapacityEffect(context, workItem, dispatch.retryAt ?? "probe");
    return;
  }
  if (
    dispatch?.state !== "leased" ||
    !lease ||
    !leaseMatchesAssignment(workItem, lease) ||
    !isFuture(lease.expiresAt, context.nowMs)
  ) {
    addCapacityEffect(context, workItem, lease?.leaseId ?? "initial");
    return;
  }

  const dedupeKey = effectKey(
    context.snapshot.runId,
    "start_turn",
    workItem.workItemId,
    dispatch.dispatchId,
    lease.leaseId
  );
  if (context.occupiedDedupeKeys.has(dedupeKey)) {
    return;
  }
  if (!reserveParallelSlot(context)) {
    if (isFuture(lease.expiresAt, context.nowMs)) {
      addWakeup(context, lease.expiresAt);
    }
    return;
  }
  addEffect(context, {
    type: "start_turn",
    runId: context.snapshot.runId,
    workItemId: workItem.workItemId,
    dispatchId: dispatch.dispatchId,
    leaseId: lease.leaseId,
    agentIdentityId: lease.agentIdentityId,
    dedupeKey,
  });
}

function addCapacityEffect(
  context: ReconcileContext,
  workItem: WorkflowWorkItemSnapshot,
  generation: string
): void {
  addEffect(context, {
    type: "request_capacity",
    runId: context.snapshot.runId,
    workItemId: workItem.workItemId,
    ...(workItem.dispatch ? { dispatchId: workItem.dispatch.dispatchId } : {}),
    ...(workItem.assignedAgentIdentityId
      ? { assignedAgentIdentityId: workItem.assignedAgentIdentityId }
      : {}),
    dedupeKey: effectKey(
      context.snapshot.runId,
      "request_capacity",
      workItem.workItemId,
      workItem.dispatch?.dispatchId ?? "new",
      generation
    ),
  });
}

function reconcileFinalVerification(context: ReconcileContext): void {
  const verification = context.snapshot.finalVerification;
  if (verification.status === "not_started") {
    addEffect(context, {
      type: "run_verification",
      scope: "run",
      runId: context.snapshot.runId,
      verificationId: verification.verificationId,
      dedupeKey: effectKey(
        context.snapshot.runId,
        "run_verification",
        "run",
        verification.verificationId
      ),
    });
  } else if (verification.blockingDecisionId) {
    addDecisionEffect(context, verification.blockingDecisionId);
  }
}

function buildDecision(
  context: ReconcileContext,
  workItems: DerivedWorkflowWorkItemState[],
  activeCount: number,
  readyForFinalization: boolean,
  completionEligible: boolean
): RunReconcilerDecision {
  const earliestWakeupAt = earliestWakeup(context.wakeups);
  return {
    effects: context.effects,
    workItems,
    activeCount,
    availableParallelism: context.remainingParallelism,
    ...(earliestWakeupAt ? { earliestWakeupAt } : {}),
    readyForFinalization,
    completionEligible,
  };
}

function deriveWorkItemState(
  workItem: WorkflowWorkItemSnapshot,
  workItemsById: Map<string, WorkflowWorkItemSnapshot>,
  nowMs: number
): DerivedWorkflowWorkItemState {
  const dependenciesAreSatisfied = dependenciesSucceeded(
    workItem,
    workItemsById
  );
  const needsUser = Boolean(getBlockingDecisionId(workItem));
  const attempt = workItem.activeAttempt;
  const hasExecutionBlocker = Boolean(workItem.outcome || attempt || needsUser);
  const ready =
    !hasExecutionBlocker &&
    dependenciesAreSatisfied &&
    !isFuture(workItem.notBefore, nowMs);
  const waitingCapacity =
    attempt?.status === "waiting_capacity" ||
    (ready &&
      (workItem.dispatch?.state === "capacity_requested" ||
        (workItem.dispatch?.state === "leased" &&
          !hasValidLease(workItem, nowMs))));
  return {
    workItemId: workItem.workItemId,
    uiStatus: deriveUiStatus(
      workItem,
      dependenciesAreSatisfied,
      needsUser,
      ready,
      waitingCapacity,
      nowMs
    ),
    dependenciesSucceeded: dependenciesAreSatisfied,
    needsUser,
    ready,
    running: attempt?.status === "starting" || attempt?.status === "running",
    waitingCapacity,
  };
}

function deriveUiStatus(
  workItem: WorkflowWorkItemSnapshot,
  dependenciesAreSatisfied: boolean,
  needsUser: boolean,
  ready: boolean,
  waitingCapacity: boolean,
  nowMs: number
): WorkflowWorkItemUiStatus {
  if (isAcceptedSuccessfulWorkItem(workItem)) {
    return "completed";
  }
  if (workItem.outcome?.status === "failed") {
    return "failed";
  }
  if (workItem.outcome?.status === "cancelled") {
    return "cancelled";
  }
  if (needsUser) {
    return "needs_user";
  }
  if (workItem.activeAttempt?.status === "uncertain") {
    return "dispatch_uncertain";
  }
  if (waitingCapacity) {
    return "waiting_capacity";
  }
  if (
    workItem.activeAttempt?.status === "starting" ||
    workItem.activeAttempt?.status === "running"
  ) {
    return "running";
  }
  if (
    workItem.integration?.status === "pending" ||
    workItem.integration?.status === "running"
  ) {
    return "integrating";
  }
  if (
    workItem.outcome?.status === "succeeded" ||
    workItem.activeAttempt?.status === "completed"
  ) {
    return "verifying";
  }
  if (isFuture(workItem.notBefore, nowMs)) {
    return "scheduled";
  }
  if (!dependenciesAreSatisfied) {
    return "blocked";
  }
  if (
    ready &&
    (workItem.dispatch?.state === "start_requested" ||
      hasValidLease(workItem, nowMs))
  ) {
    return "queued";
  }
  return "ready";
}

function isInactiveRun(snapshot: RunReconcilerSnapshot): boolean {
  return (
    snapshot.desiredState !== "running" ||
    snapshot.phase === "finished" ||
    snapshot.outcome !== undefined
  );
}

function dependenciesSucceeded(
  workItem: WorkflowWorkItemSnapshot,
  workItemsById: Map<string, WorkflowWorkItemSnapshot>
): boolean {
  return workItem.dependencies.every((dependencyId) => {
    const dependency = workItemsById.get(dependencyId);
    return dependency ? isAcceptedSuccessfulWorkItem(dependency) : false;
  });
}

function isAcceptedSuccessfulWorkItem(
  workItem: WorkflowWorkItemSnapshot
): boolean {
  const outcome = workItem.outcome;
  if (outcome?.status !== "succeeded") {
    return false;
  }
  if (workItem.integration && workItem.integration.status !== "succeeded") {
    return false;
  }
  if (
    outcome.acceptance === "user_accepted" ||
    outcome.acceptance === "waived"
  ) {
    return true;
  }
  if (
    outcome.acceptance === "machine_verified" &&
    outcome.evidenceRefs.length > 0
  ) {
    return true;
  }
  return hasAcceptedVerificationEvidence(workItem.verification);
}

function isFinalVerificationAccepted(
  verification: WorkflowVerificationFacts
): boolean {
  return (
    verification.status === "not_required" ||
    hasAcceptedVerificationEvidence(verification)
  );
}

function hasAcceptedVerificationEvidence(
  verification: WorkflowVerificationFacts | undefined
): boolean {
  return (
    verification?.status === "accepted" ||
    (verification?.status === "passed" && verification.evidenceRefs.length > 0)
  );
}

function getBlockingDecisionId(
  workItem: WorkflowWorkItemSnapshot
): string | undefined {
  return (
    workItem.blockingDecisionId ??
    workItem.integration?.blockingDecisionId ??
    workItem.verification?.blockingDecisionId
  );
}

function countActiveSlots(workItems: WorkflowWorkItemSnapshot[]): number {
  return workItems.filter(
    (workItem) =>
      workItem.activeAttempt?.status === "starting" ||
      workItem.activeAttempt?.status === "running" ||
      workItem.activeAttempt?.status === "uncertain" ||
      workItem.dispatch?.state === "start_requested"
  ).length;
}

function hasValidLease(
  workItem: WorkflowWorkItemSnapshot,
  nowMs: number
): boolean {
  const lease = workItem.capacityLease;
  return Boolean(
    lease &&
      leaseMatchesAssignment(workItem, lease) &&
      isFuture(lease.expiresAt, nowMs)
  );
}

function leaseMatchesAssignment(
  workItem: WorkflowWorkItemSnapshot,
  lease: WorkflowCapacityLeaseFacts
): boolean {
  return (
    !workItem.assignedAgentIdentityId ||
    workItem.assignedAgentIdentityId === lease.agentIdentityId
  );
}

function reserveParallelSlot(context: ReconcileContext): boolean {
  if (context.remainingParallelism <= 0) {
    return false;
  }
  context.remainingParallelism -= 1;
  return true;
}

function addDecisionEffect(
  context: ReconcileContext,
  decisionId: string,
  workItemId?: string
): void {
  addEffect(context, {
    type: "request_decision",
    runId: context.snapshot.runId,
    decisionId,
    ...(workItemId ? { workItemId } : {}),
    dedupeKey: effectKey(
      context.snapshot.runId,
      "request_decision",
      workItemId ?? "run",
      decisionId
    ),
  });
}

function addEffect(
  context: ReconcileContext,
  effect: WorkflowEffectIntent
): boolean {
  if (context.occupiedDedupeKeys.has(effect.dedupeKey)) {
    return false;
  }
  context.occupiedDedupeKeys.add(effect.dedupeKey);
  context.effects.push(effect);
  return true;
}

function addWakeup(context: ReconcileContext, at: string): void {
  context.wakeups.set(at, parseTimestamp(at, "wakeup"));
}

function scheduleEarliestWakeup(context: ReconcileContext): void {
  const at = earliestWakeup(context.wakeups);
  if (!at) {
    return;
  }
  addEffect(context, {
    type: "schedule_wakeup",
    runId: context.snapshot.runId,
    at,
    dedupeKey: effectKey(context.snapshot.runId, "schedule_wakeup", at),
  });
}

function earliestWakeup(wakeups: Map<string, number>): string | undefined {
  return [...wakeups.entries()].sort(
    ([leftAt, leftMs], [rightAt, rightMs]) =>
      leftMs - rightMs || leftAt.localeCompare(rightAt)
  )[0]?.[0];
}

function isFuture(value: string | undefined, nowMs: number): boolean {
  return value !== undefined && parseTimestamp(value, "timestamp") > nowMs;
}

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid workflow ${label}: ${value}`);
  }
  return parsed;
}

function effectKey(runId: string, type: string, ...parts: string[]): string {
  return [runId, type, ...parts].map(encodeURIComponent).join(":");
}

function compareWorkItems(
  left: WorkflowWorkItemSnapshot,
  right: WorkflowWorkItemSnapshot
): number {
  return left.workItemId.localeCompare(right.workItemId);
}
