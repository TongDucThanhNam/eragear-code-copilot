import {
  isActiveSupervisorAttemptStatus,
  type SupervisorRunState,
  type SupervisorRunStatus,
  type SupervisorTaskRecord,
  type SupervisorTaskStatus,
} from "./supervisor-run.schemas";

const COMPAT_RUN_BLOCKER_ID = "compat-run-needs-user";
const COMPAT_TASK_BLOCKER_ID_PREFIX = "compat-task-needs-user";

export function deriveSupervisorTaskStatus(
  run: SupervisorRunState,
  task: SupervisorTaskRecord,
  now = run.updatedAt
): SupervisorTaskStatus {
  if (task.outcome === "succeeded") {
    return "completed";
  }
  if (task.outcome === "failed") {
    return "failed";
  }
  if (task.outcome === "cancelled") {
    return "cancelled";
  }
  const workflowStatus = deriveWorkflowTaskStatus(task, now);
  if (workflowStatus) {
    return workflowStatus;
  }
  if (task.activity === "capacity_wait") {
    return "waiting_capacity";
  }
  if (task.activity === "dispatching") {
    return "queued";
  }
  if (task.activity === "agent_turn") {
    return "running";
  }
  if (task.activity === "verification") {
    return "reviewing";
  }
  if (task.activity === "integration") {
    return "integrating";
  }
  if (task.notBefore && Date.parse(task.notBefore) > Date.parse(now)) {
    return "blocked";
  }
  const succeeded = new Set(
    run.tasks
      .filter((candidate) => candidate.outcome === "succeeded")
      .map((candidate) => candidate.taskId)
  );
  return task.dependencies.every((dependency) => succeeded.has(dependency))
    ? "ready"
    : "blocked";
}

function deriveWorkflowTaskStatus(
  task: SupervisorTaskRecord,
  now: string
): SupervisorTaskStatus | undefined {
  if (getWorkflowTaskBlocker(task)) {
    return "needs_user";
  }
  const activeAttempt = task.activeAttemptId
    ? task.attempts.find(
        (attempt) => attempt.attemptId === task.activeAttemptId
      )
    : undefined;
  if (activeAttempt?.status === "waiting_capacity") {
    return "waiting_capacity";
  }
  if (
    activeAttempt?.status === "starting" ||
    activeAttempt?.status === "running" ||
    activeAttempt?.status === "uncertain"
  ) {
    return "running";
  }
  if (
    task.integration?.status === "pending" ||
    task.integration?.status === "running"
  ) {
    return "integrating";
  }
  if (task.integration?.status === "failed") {
    return "needs_user";
  }
  if (
    task.verification?.status === "running" ||
    (task.verification?.status === "not_started" &&
      task.attempts.some(
        (attempt) =>
          attempt.status === "terminal" &&
          attempt.result?.semanticStatus === "succeeded"
      ))
  ) {
    return "reviewing";
  }
  if (task.verification?.status === "failed") {
    return "needs_user";
  }
  if (task.dispatch?.state === "capacity_requested") {
    return "waiting_capacity";
  }
  if (
    task.dispatch?.state === "leased" &&
    (!task.capacityLease ||
      Date.parse(task.capacityLease.expiresAt) <= Date.parse(now))
  ) {
    return "waiting_capacity";
  }
  if (
    task.dispatch?.state === "leased" ||
    task.dispatch?.state === "start_requested"
  ) {
    return "queued";
  }
  return undefined;
}

export function deriveSupervisorRunStatus(
  run: SupervisorRunState,
  now = run.updatedAt
): SupervisorRunStatus {
  if (run.outcome === "succeeded") {
    return "completed";
  }
  if (run.outcome === "failed") {
    return "failed";
  }
  if (run.outcome === "cancelled") {
    return "cancelled";
  }
  if (run.desiredState === "cancelled") {
    return "paused";
  }
  if (run.desiredState === "paused") {
    return "paused";
  }
  if (run.phase === "planning") {
    return derivePlanningSupervisorRunStatus(run);
  }
  if (run.phase === "finalizing") {
    return deriveFinalizingSupervisorRunStatus(run);
  }
  if (run.phase === "finished") {
    throw new Error("Finished supervisor runs require an outcome");
  }
  if (run.blockingDecisionId) {
    return "needs_user";
  }
  if (run.activity === "capacity_wait") {
    return "waiting_capacity";
  }

  return deriveExecutingSupervisorRunStatus(run, now);
}

function derivePlanningSupervisorRunStatus(
  run: SupervisorRunState
): SupervisorRunStatus {
  if (run.blockingDecisionId || run.workflowPlan?.blockingDecisionId) {
    return "needs_user";
  }
  if (run.activity === "capacity_wait") {
    return "waiting_capacity";
  }
  if (
    run.workflowPlan?.status === "available" ||
    run.workflowPlan?.status === "proposed" ||
    (run.plan && !run.plan.approvedAt)
  ) {
    return "awaiting_approval";
  }
  if (run.workflowPlan?.status === "failed") {
    return "needs_user";
  }
  return run.activity === "planning" ? "planning" : "draft";
}

function deriveFinalizingSupervisorRunStatus(
  run: SupervisorRunState
): SupervisorRunStatus {
  if (
    run.blockingDecisionId ||
    run.workflowFinalVerification?.blockingDecisionId ||
    run.finalization?.blockingDecisionId ||
    run.finalization?.status === "failed"
  ) {
    return "needs_user";
  }
  return "completing";
}

function getWorkflowTaskBlocker(
  task: SupervisorTaskRecord
): string | undefined {
  return (
    task.blockingDecisionId ??
    task.verification?.blockingDecisionId ??
    task.integration?.blockingDecisionId
  );
}

function deriveExecutingSupervisorRunStatus(
  run: SupervisorRunState,
  now: string
): SupervisorRunStatus {
  const taskStatuses = run.tasks.map((task) =>
    deriveSupervisorTaskStatus(run, task, now)
  );
  const pendingTaskStatuses = taskStatuses.filter(
    (status) =>
      status !== "completed" && status !== "failed" && status !== "cancelled"
  );
  if (
    pendingTaskStatuses.length > 0 &&
    pendingTaskStatuses.every((status) => status === "waiting_capacity")
  ) {
    return "waiting_capacity";
  }
  if (
    taskStatuses.some(
      (status) =>
        status === "running" ||
        status === "reviewing" ||
        status === "integrating"
    )
  ) {
    return "running";
  }
  if (taskStatuses.some((status) => status === "ready")) {
    return run.activity === "executing" ? "running" : "queued";
  }
  if (taskStatuses.some((status) => status === "needs_user")) {
    return "needs_user";
  }
  if (run.activity === "executing") {
    return "running";
  }
  return "queued";
}

export function projectSupervisorCompatibilityStatuses(
  run: SupervisorRunState,
  now = run.updatedAt
): void {
  for (const task of run.tasks) {
    task.status = deriveSupervisorTaskStatus(run, task, now);
  }
  run.status = deriveSupervisorRunStatus(run, now);
}

export function translateLegacyStatusMutationsToFacts(
  current: SupervisorRunState,
  draft: SupervisorRunState
): void {
  if (current.status !== draft.status) {
    applyLegacyRunStatusFacts(draft, draft.status);
  }
  const currentTasks = new Map(
    current.tasks.map((task) => [task.taskId, task] as const)
  );
  for (const task of draft.tasks) {
    const previous = currentTasks.get(task.taskId);
    if (!previous || previous.status !== task.status) {
      applyLegacyTaskStatusFacts(draft, task, task.status);
    }
    synchronizeActiveAttemptReference(task);
  }
}

export function normalizeStoredCompatibilityFacts(
  run: SupervisorRunState,
  now = run.updatedAt
): void {
  for (const task of run.tasks) {
    synchronizeActiveAttemptReference(task);
  }
  projectSupervisorCompatibilityStatuses(run, now);
}

export function assertSupervisorCompatibilityStatuses(
  run: SupervisorRunState,
  now = run.updatedAt
): void {
  const expectedRunStatus = deriveSupervisorRunStatus(run, now);
  if (run.status !== expectedRunStatus) {
    throw new Error(
      `Supervisor run compatibility status mismatch: stored ${run.status}, derived ${expectedRunStatus}`
    );
  }
  for (const task of run.tasks) {
    const expectedTaskStatus = deriveSupervisorTaskStatus(run, task, now);
    if (task.status !== expectedTaskStatus) {
      throw new Error(
        `Supervisor task ${task.taskId} compatibility status mismatch: stored ${task.status}, derived ${expectedTaskStatus}`
      );
    }
  }
}

export function synchronizeActiveAttemptReference(
  task: SupervisorTaskRecord
): void {
  const activeAttempts = task.attempts.filter((attempt) =>
    isActiveSupervisorAttemptStatus(attempt.status)
  );
  if (activeAttempts.length === 1) {
    task.activeAttemptId = activeAttempts[0]?.attemptId;
  } else {
    clearOptionalProperty(task, "activeAttemptId");
  }
}

function applyLegacyRunStatusFacts(
  run: SupervisorRunState,
  status: SupervisorRunStatus
): void {
  if (status !== "needs_user") {
    clearOptionalProperty(run, "blockingDecisionId");
  }
  if (status !== "completed" && status !== "failed" && status !== "cancelled") {
    clearOptionalProperty(run, "outcome");
  }

  switch (status) {
    case "draft":
      run.desiredState = "running";
      run.phase = "planning";
      clearOptionalProperty(run, "activity");
      return;
    case "planning":
      run.desiredState = "running";
      run.phase = "planning";
      run.activity = "planning";
      return;
    case "awaiting_approval":
      run.desiredState = "running";
      run.phase = "planning";
      clearOptionalProperty(run, "activity");
      return;
    case "queued":
      run.desiredState = "running";
      run.phase = "executing";
      run.activity = "dispatching";
      return;
    case "running":
      run.desiredState = "running";
      run.phase = "executing";
      run.activity = "executing";
      return;
    case "waiting_capacity":
      run.desiredState = "running";
      run.activity = "capacity_wait";
      return;
    case "paused":
      run.desiredState = "paused";
      return;
    case "needs_user":
      run.blockingDecisionId = ensureCompatibilityDecision(
        run,
        run.blockingDecisionId ??
          run.decisions.find((decision) => decision.status === "open")
            ?.decisionId ??
          COMPAT_RUN_BLOCKER_ID,
        "Legacy Supervisor run requires user input"
      );
      return;
    case "completing":
      run.desiredState = "running";
      run.phase = "finalizing";
      run.activity = "finalizing";
      return;
    case "completed":
      run.desiredState = "running";
      run.phase = "finished";
      run.outcome = "succeeded";
      clearOptionalProperty(run, "activity");
      return;
    case "failed":
      run.desiredState = "running";
      run.phase = "finished";
      run.outcome = "failed";
      clearOptionalProperty(run, "activity");
      return;
    case "cancelled":
      run.desiredState = "cancelled";
      run.phase = "finished";
      run.outcome = "cancelled";
      clearOptionalProperty(run, "activity");
      return;
    default:
      assertUnreachable(status);
  }
}

function applyLegacyTaskStatusFacts(
  run: SupervisorRunState,
  task: SupervisorTaskRecord,
  status: SupervisorTaskStatus
): void {
  if (status !== "needs_user") {
    clearOptionalProperty(task, "blockingDecisionId");
  }
  if (status !== "completed" && status !== "failed" && status !== "cancelled") {
    clearOptionalProperty(task, "outcome");
  }
  if (status !== "waiting_capacity") {
    clearOptionalProperty(task, "notBefore");
  }

  switch (status) {
    case "blocked":
    case "ready":
      clearOptionalProperty(task, "activity");
      return;
    case "queued":
      task.activity = "dispatching";
      return;
    case "running":
      task.activity = "agent_turn";
      return;
    case "waiting_capacity":
      task.activity = "capacity_wait";
      task.notBefore = run.capacityWaits.find(
        (wait) => wait.owner === "task" && wait.taskId === task.taskId
      )?.retryAt;
      return;
    case "reviewing":
      task.activity = "verification";
      return;
    case "integrating":
      task.activity = "integration";
      return;
    case "completed":
      task.outcome = "succeeded";
      clearOptionalProperty(task, "activity");
      return;
    case "needs_user":
      task.blockingDecisionId = ensureCompatibilityDecision(
        run,
        task.blockingDecisionId ??
          `${COMPAT_TASK_BLOCKER_ID_PREFIX}:${task.taskId}`,
        `Legacy Supervisor task ${task.taskId} requires user input`
      );
      clearOptionalProperty(task, "activity");
      return;
    case "failed":
      task.outcome = "failed";
      clearOptionalProperty(task, "activity");
      return;
    case "cancelled":
      task.outcome = "cancelled";
      clearOptionalProperty(task, "activity");
      return;
    default:
      assertUnreachable(status);
  }
}

function ensureCompatibilityDecision(
  run: SupervisorRunState,
  decisionId: string,
  prompt: string
): string {
  const existing = run.decisions.find(
    (decision) => decision.decisionId === decisionId
  );
  if (existing?.status === "open") {
    return decisionId;
  }
  const durableDecisionId = existing
    ? `${COMPAT_RUN_BLOCKER_ID}:${run.revision + 1}:${run.decisions.length + 1}`
    : decisionId;
  run.decisions.push({
    decisionId: durableDecisionId,
    kind: "product_ambiguity",
    status: "open",
    prompt,
    createdAt: run.updatedAt,
  });
  return durableDecisionId;
}

function clearOptionalProperty(object: object, key: PropertyKey): void {
  Reflect.deleteProperty(object, key);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported compatibility status: ${String(value)}`);
}
