import {
  deriveSupervisorTaskStatus,
  normalizeStoredCompatibilityFacts,
  projectSupervisorCompatibilityStatuses,
  translateLegacyStatusMutationsToFacts,
} from "./supervisor-run.projections";
import {
  type SupervisorRunState,
  SupervisorRunStateSchema,
  type SupervisorRunStatus,
  type SupervisorTaskRecord,
  type SupervisorTaskStatus,
} from "./supervisor-run.schemas";

const RUN_TRANSITIONS: Record<
  SupervisorRunStatus,
  readonly SupervisorRunStatus[]
> = {
  draft: ["planning", "paused", "cancelled"],
  planning: [
    "awaiting_approval",
    "queued",
    "waiting_capacity",
    "paused",
    "needs_user",
    "failed",
    "cancelled",
  ],
  awaiting_approval: [
    "planning",
    "queued",
    "paused",
    "needs_user",
    "cancelled",
  ],
  queued: [
    "planning",
    "running",
    "waiting_capacity",
    "paused",
    "needs_user",
    "failed",
    "cancelled",
  ],
  running: [
    "planning",
    "waiting_capacity",
    "paused",
    "needs_user",
    "completing",
    "failed",
    "cancelled",
  ],
  waiting_capacity: [
    "planning",
    "queued",
    "running",
    "paused",
    "needs_user",
    "failed",
    "cancelled",
  ],
  paused: [
    "planning",
    "queued",
    "running",
    "waiting_capacity",
    "needs_user",
    "cancelled",
  ],
  needs_user: [
    "planning",
    "awaiting_approval",
    "queued",
    "running",
    "completing",
    "paused",
    "failed",
    "cancelled",
  ],
  completing: ["completed", "paused", "needs_user", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const TASK_TRANSITIONS: Record<
  SupervisorTaskStatus,
  readonly SupervisorTaskStatus[]
> = {
  blocked: ["ready", "cancelled"],
  ready: ["queued", "blocked", "needs_user", "cancelled"],
  queued: [
    "running",
    "waiting_capacity",
    "ready",
    "needs_user",
    "failed",
    "cancelled",
  ],
  running: [
    "waiting_capacity",
    "ready",
    "reviewing",
    "needs_user",
    "failed",
    "cancelled",
  ],
  waiting_capacity: ["running", "ready", "needs_user", "failed", "cancelled"],
  reviewing: ["integrating", "completed", "needs_user", "failed", "cancelled"],
  integrating: ["completed", "needs_user", "failed", "cancelled"],
  completed: [],
  needs_user: [
    "ready",
    "queued",
    "integrating",
    "completed",
    "failed",
    "cancelled",
  ],
  failed: ["ready", "cancelled"],
  cancelled: [],
};

export class SupervisorRunRevisionConflictError extends Error {
  readonly runId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(runId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Supervisor run ${runId} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "SupervisorRunRevisionConflictError";
    this.runId = runId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class InvalidSupervisorRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSupervisorRunTransitionError";
  }
}

export function transitionSupervisorRun(
  current: SupervisorRunState,
  input: {
    expectedRevision: number;
    now: string;
    mutate: (draft: SupervisorRunState) => void;
  }
): SupervisorRunState {
  const normalizedCurrent = structuredClone(current);
  normalizeStoredCompatibilityFacts(normalizedCurrent, input.now);
  const parsedCurrent = SupervisorRunStateSchema.parse(normalizedCurrent);
  if (parsedCurrent.revision !== input.expectedRevision) {
    throw new SupervisorRunRevisionConflictError(
      parsedCurrent.runId,
      input.expectedRevision,
      parsedCurrent.revision
    );
  }

  const draft = structuredClone(parsedCurrent);
  input.mutate(draft);
  const requestedRunStatus =
    draft.status === parsedCurrent.status ? undefined : draft.status;
  const currentTasks = new Map(
    parsedCurrent.tasks.map((task) => [task.taskId, task] as const)
  );
  const requestedTaskStatuses = new Map(
    draft.tasks.flatMap((task) => {
      const currentTask = currentTasks.get(task.taskId);
      return !currentTask || currentTask.status !== task.status
        ? [[task.taskId, task.status] as const]
        : [];
    })
  );
  translateLegacyStatusMutationsToFacts(parsedCurrent, draft);
  projectSupervisorCompatibilityStatuses(draft, input.now);
  assertRequestedLegacyStatusProjection(
    draft,
    requestedRunStatus,
    requestedTaskStatuses
  );
  assertImmutableRunIdentity(parsedCurrent, draft);
  assertRunStatusTransition(parsedCurrent.status, draft.status);
  assertTaskTransitions(parsedCurrent.tasks, draft.tasks);
  draft.revision = parsedCurrent.revision + 1;
  draft.updatedAt = input.now;
  return SupervisorRunStateSchema.parse(draft);
}

function assertRequestedLegacyStatusProjection(
  draft: SupervisorRunState,
  requestedRunStatus: SupervisorRunStatus | undefined,
  requestedTaskStatuses: ReadonlyMap<string, SupervisorTaskStatus>
): void {
  if (requestedRunStatus && draft.status !== requestedRunStatus) {
    throw new InvalidSupervisorRunTransitionError(
      `Supervisor run status is not a valid lifecycle projection: requested ${requestedRunStatus}, derived ${draft.status}`
    );
  }
  for (const [taskId, requestedStatus] of requestedTaskStatuses) {
    const task = draft.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task || task.status !== requestedStatus) {
      throw new InvalidSupervisorRunTransitionError(
        `Supervisor task status is not a valid lifecycle projection for ${taskId}: requested ${requestedStatus}, derived ${task?.status ?? "missing"}`
      );
    }
  }
}

export function setSupervisorRunStatus(
  draft: SupervisorRunState,
  status: SupervisorRunStatus
): void {
  if (draft.status === status) {
    return;
  }
  assertRunStatusTransition(draft.status, status);
  draft.status = status;
}

export function setSupervisorTaskStatus(
  draft: SupervisorRunState,
  taskId: string,
  status: SupervisorTaskStatus
): void {
  const task = draft.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new InvalidSupervisorRunTransitionError(`Unknown task: ${taskId}`);
  }
  if (task.status === status) {
    return;
  }
  assertTaskStatusTransition(task.status, status, taskId);
  task.status = status;
}

export function deriveReadyTaskIds(
  run: SupervisorRunState,
  now = run.updatedAt
): string[] {
  return run.tasks
    .filter((task) => deriveSupervisorTaskStatus(run, task, now) === "ready")
    .map((task) => task.taskId);
}

export function recomputeSupervisorTaskReadiness(
  draft: SupervisorRunState,
  now = draft.updatedAt
): void {
  projectSupervisorCompatibilityStatuses(draft, now);
}

function assertImmutableRunIdentity(
  current: SupervisorRunState,
  draft: SupervisorRunState
): void {
  const immutableFields = [
    "schemaVersion",
    "runId",
    "userId",
    "projectId",
    "projectRoot",
    "originalIntent",
    "createdAt",
  ] as const;
  for (const field of immutableFields) {
    if (current[field] !== draft[field]) {
      throw new InvalidSupervisorRunTransitionError(
        `Supervisor run identity field cannot change: ${field}`
      );
    }
  }
}

function assertRunStatusTransition(
  from: SupervisorRunStatus,
  to: SupervisorRunStatus
): void {
  if (from === to) {
    return;
  }
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new InvalidSupervisorRunTransitionError(
      `Invalid supervisor run transition: ${from} -> ${to}`
    );
  }
}

function assertTaskTransitions(
  currentTasks: SupervisorTaskRecord[],
  nextTasks: SupervisorTaskRecord[]
): void {
  // V3 task statuses are compatibility projections of independent facts.
  // One atomic fact transition may therefore skip legacy presentation states
  // (for example ready -> waiting_capacity when a capacity intent is stored).
  // Terminal immutability is enforced by the schema/reducer; keep only the
  // replan invariant here. Explicit legacy callers of setSupervisorTaskStatus
  // still pass through assertTaskStatusTransition.
  for (const current of currentTasks) {
    if (
      current.status === "completed" &&
      !nextTasks.some((task) => task.taskId === current.taskId)
    ) {
      throw new InvalidSupervisorRunTransitionError(
        `Completed task cannot be removed by replan: ${current.taskId}`
      );
    }
  }
}

function assertTaskStatusTransition(
  from: SupervisorTaskStatus,
  to: SupervisorTaskStatus,
  taskId: string
): void {
  if (from === to) {
    return;
  }
  if (!TASK_TRANSITIONS[from].includes(to)) {
    throw new InvalidSupervisorRunTransitionError(
      `Invalid supervisor task transition for ${taskId}: ${from} -> ${to}`
    );
  }
}
