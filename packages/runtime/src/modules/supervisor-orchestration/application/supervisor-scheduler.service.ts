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

export class SupervisorSchedulerService {
  evaluate(run: SupervisorRunState): SupervisorScheduleDecision {
    const completed = new Set(
      run.tasks
        .filter((task) => task.status === "completed")
        .map((task) => task.taskId)
    );
    const activeCount = run.tasks.filter((task) =>
      ACTIVE_TASK_STATUSES.has(task.status)
    ).length;
    const availableCapacity = Math.max(
      0,
      run.limits.maxConcurrency - activeCount
    );
    const readyTaskIds: string[] = [];
    const blockedTaskIds: string[] = [];

    for (const task of run.tasks) {
      if (task.status !== "ready" && task.status !== "blocked") {
        continue;
      }
      const dependenciesComplete = task.dependencies.every((dependency) =>
        completed.has(dependency)
      );
      const attemptsAvailable =
        task.attempts.length < run.limits.maxAttemptsPerTask;
      if (dependenciesComplete && attemptsAvailable) {
        readyTaskIds.push(task.taskId);
      } else {
        blockedTaskIds.push(task.taskId);
      }
    }

    const dispatchAllowed = run.status === "queued" || run.status === "running";
    return {
      dispatchTaskIds: dispatchAllowed
        ? readyTaskIds.slice(0, availableCapacity)
        : [],
      readyTaskIds,
      blockedTaskIds,
      activeCount,
      availableCapacity,
    };
  }
}
