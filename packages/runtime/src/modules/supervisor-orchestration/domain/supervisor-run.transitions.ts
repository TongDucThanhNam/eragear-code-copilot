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
  draft: ["planning", "cancelled"],
  planning: ["queued", "needs_user", "failed", "cancelled"],
  queued: ["running", "paused", "needs_user", "failed", "cancelled"],
  running: ["paused", "needs_user", "completing", "failed", "cancelled"],
  paused: ["queued", "running", "needs_user", "cancelled"],
  needs_user: ["queued", "running", "completing", "failed", "cancelled"],
  completing: ["completed", "needs_user", "failed", "cancelled"],
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
  queued: ["running", "ready", "needs_user", "failed", "cancelled"],
  running: ["ready", "reviewing", "needs_user", "failed", "cancelled"],
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
  const parsedCurrent = SupervisorRunStateSchema.parse(current);
  if (parsedCurrent.revision !== input.expectedRevision) {
    throw new SupervisorRunRevisionConflictError(
      parsedCurrent.runId,
      input.expectedRevision,
      parsedCurrent.revision
    );
  }

  const draft = structuredClone(parsedCurrent);
  input.mutate(draft);
  assertImmutableRunIdentity(parsedCurrent, draft);
  assertRunStatusTransition(parsedCurrent.status, draft.status);
  assertTaskTransitions(parsedCurrent.tasks, draft.tasks);
  draft.revision = parsedCurrent.revision + 1;
  draft.updatedAt = input.now;
  return SupervisorRunStateSchema.parse(draft);
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

export function deriveReadyTaskIds(run: SupervisorRunState): string[] {
  const completed = new Set(
    run.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.taskId)
  );
  return run.tasks
    .filter(
      (task) =>
        (task.status === "blocked" || task.status === "ready") &&
        task.dependencies.every((dependency) => completed.has(dependency))
    )
    .map((task) => task.taskId);
}

export function recomputeSupervisorTaskReadiness(
  draft: SupervisorRunState
): void {
  const completed = new Set(
    draft.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.taskId)
  );
  for (const task of draft.tasks) {
    if (task.status !== "blocked" && task.status !== "ready") {
      continue;
    }
    task.status = task.dependencies.every((dependency) =>
      completed.has(dependency)
    )
      ? "ready"
      : "blocked";
  }
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
  const currentById = new Map(currentTasks.map((task) => [task.taskId, task]));
  for (const task of nextTasks) {
    const current = currentById.get(task.taskId);
    if (current) {
      assertTaskStatusTransition(current.status, task.status, task.taskId);
    }
  }

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
