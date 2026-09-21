import {
  deriveSupervisorRunStatus,
  deriveSupervisorTaskStatus,
} from "../domain/supervisor-run.projections";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

const ACTIVE_TASK_STATUSES = new Set([
  "queued",
  "running",
  "reviewing",
  "integrating",
]);

export interface SupervisorScheduleDecision {
  dispatchTaskIds: string[];
  readyTaskIds: string[];
  blockedTaskIds: string[];
  activeCount: number;
  availableCapacity: number;
}

export function isSupervisorRunDispatchable(
  run: SupervisorRunState,
  now: string
): boolean {
  const status = deriveSupervisorRunStatus(run, now);
  return status === "queued" || status === "running";
}

export function evaluateSupervisorSchedule(
  run: SupervisorRunState,
  now: string
): SupervisorScheduleDecision {
  const taskStatuses = new Map(
    run.tasks.map((task) => [
      task.taskId,
      deriveSupervisorTaskStatus(run, task, now),
    ])
  );
  const activeCount = run.tasks.filter((task) =>
    ACTIVE_TASK_STATUSES.has(taskStatuses.get(task.taskId) ?? "blocked")
  ).length;
  const availableCapacity = Math.max(
    0,
    run.limits.maxConcurrency - activeCount
  );
  const readyTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];

  for (const task of run.tasks) {
    const status = taskStatuses.get(task.taskId);
    if (status !== "ready" && status !== "blocked") {
      continue;
    }
    const attemptsAvailable =
      task.attempts.length < run.limits.maxAttemptsPerTask;
    if (status === "ready" && attemptsAvailable) {
      readyTaskIds.push(task.taskId);
    } else {
      blockedTaskIds.push(task.taskId);
    }
  }

  return {
    dispatchTaskIds: isSupervisorRunDispatchable(run, now)
      ? readyTaskIds.slice(0, availableCapacity)
      : [],
    readyTaskIds,
    blockedTaskIds,
    activeCount,
    availableCapacity,
  };
}

export class SupervisorSchedulerService {
  evaluate(
    run: SupervisorRunState,
    now = new Date().toISOString()
  ): SupervisorScheduleDecision {
    return evaluateSupervisorSchedule(run, now);
  }
}
