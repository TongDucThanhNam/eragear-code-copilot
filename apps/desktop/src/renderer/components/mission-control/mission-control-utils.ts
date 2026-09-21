import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";

const TERMINAL_RUN_STATUSES = new Set<SupervisorRunClientUpdate["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
const ACTIVE_GOAL_INTAKE_REFETCH_MS = 1000;

export type MissionControlRunView = "active" | "history";

export interface SupervisorCancellationPresentation {
  badgeLabel: "cancelling" | "cancellation blocked";
  actionLabel: "Continue cancellation" | "Retry cancellation";
  canRetry: boolean;
  requiresAttention: boolean;
  message: string;
}

export function getGoalIntakeRefetchInterval(
  intakes:
    | readonly {
        reasoningState: "idle" | "active" | "resumable";
      }[]
    | undefined
): number | false {
  return intakes?.some((intake) => intake.reasoningState === "active")
    ? ACTIVE_GOAL_INTAKE_REFETCH_MS
    : false;
}

export function getSupervisorCancellationNotice(
  run: Pick<SupervisorRunClientUpdate, "status" | "cancellation">
): { kind: "success" | "error" | "info"; message: string } {
  if (run.status === "cancelled") {
    return { kind: "success", message: "Supervisor run cancelled" };
  }
  if (run.cancellation?.status === "failed") {
    return {
      kind: "error",
      message: "Cancellation cleanup failed. Retry cancellation.",
    };
  }
  return {
    kind: "info",
    message: "Cancellation requested. Durable cleanup is still running.",
  };
}

export function getSupervisorCancellationPresentation(
  run: Pick<SupervisorRunClientUpdate, "status" | "cancellation">
): SupervisorCancellationPresentation | undefined {
  if (run.status === "cancelled" || !run.cancellation) {
    return undefined;
  }
  const pending = [
    run.cancellation.pendingSessionCount > 0
      ? `${run.cancellation.pendingSessionCount} session${run.cancellation.pendingSessionCount === 1 ? "" : "s"}`
      : "",
    run.cancellation.pendingWorkspaceCount > 0
      ? `${run.cancellation.pendingWorkspaceCount} workspace${run.cancellation.pendingWorkspaceCount === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);
  const pendingLabel = pending.length > 0 ? pending.join(" and ") : "cleanup";
  if (run.cancellation.status === "failed") {
    return {
      badgeLabel: "cancellation blocked",
      actionLabel: "Retry cancellation",
      canRetry: true,
      requiresAttention: true,
      message: `Cancellation cleanup failed with ${pendingLabel} still pending. Retry to create a new durable cleanup attempt.`,
    };
  }
  return {
    badgeLabel: "cancelling",
    actionLabel: "Continue cancellation",
    canRetry: true,
    requiresAttention: false,
    message: `Cancellation is durable. Supervisos is finishing ${pendingLabel} before this goal moves to History. Repeating the request is safe.`,
  };
}

export function selectMissionControlProjectItems<
  T extends { projectId?: string },
>(items: readonly T[] | undefined, projectId: string | null): T[] {
  if (!projectId) {
    return [];
  }
  return (items ?? []).filter((item) => item.projectId === projectId);
}

export function isTerminalSupervisorRun(
  run: Pick<SupervisorRunClientUpdate, "status">
): boolean {
  return TERMINAL_RUN_STATUSES.has(run.status);
}

export function selectMissionControlRuns(
  runs: SupervisorRunClientUpdate[],
  view: MissionControlRunView
): SupervisorRunClientUpdate[] {
  return runs.filter((run) =>
    view === "history"
      ? isTerminalSupervisorRun(run)
      : !isTerminalSupervisorRun(run)
  );
}

export function countActionableSupervisorDecisions(
  runs: SupervisorRunClientUpdate[]
): number {
  return runs.reduce(
    (count, run) =>
      isTerminalSupervisorRun(run)
        ? count
        : count +
          run.decisions.filter((decision) => decision.status === "open").length,
    0
  );
}

export function getSupervisorRunTitle(run: SupervisorRunClientUpdate): string {
  const taskTitle = run.tasks[0]?.title.trim();
  if (taskTitle) {
    return taskTitle;
  }
  const planSummary = run.plan?.summary.trim();
  if (planSummary) {
    return planSummary;
  }
  return run.status === "planning"
    ? "Manager is planning this goal"
    : "Supervised goal";
}

export function getDirectRepositoryBlocker(
  run: SupervisorRunClientUpdate,
  runs: SupervisorRunClientUpdate[]
): SupervisorRunClientUpdate | undefined {
  if (
    run.status !== "queued" ||
    !run.projectId ||
    !run.tasks.some(
      (task) =>
        task.executionMode === "write" &&
        (task.status === "ready" || task.status === "queued") &&
        task.attempts.length === 0
    )
  ) {
    return undefined;
  }
  return runs.find(
    (candidate) =>
      candidate.runId !== run.runId &&
      candidate.projectId === run.projectId &&
      !isTerminalSupervisorRun(candidate) &&
      candidate.tasks.some(
        (task) =>
          task.executionMode === "write" &&
          task.attempts.some((attempt) =>
            ["starting", "running", "waiting_capacity"].includes(attempt.status)
          )
      )
  );
}
