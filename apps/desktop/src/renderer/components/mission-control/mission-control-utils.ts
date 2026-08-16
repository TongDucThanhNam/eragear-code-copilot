import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";

const TERMINAL_RUN_STATUSES = new Set<SupervisorRunClientUpdate["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export type MissionControlRunView = "active" | "history";

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
