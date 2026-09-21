import type {
  SupervisorRunPriority,
  SupervisorRunState,
} from "../domain/supervisor-run.schemas";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  evaluateSupervisorSchedule,
  isSupervisorRunDispatchable,
} from "./supervisor-scheduler.service";

export const SUPERVISOR_PRIORITY_WEIGHTS: Record<
  SupervisorRunPriority,
  number
> = {
  urgent: 8,
  high: 4,
  normal: 2,
  low: 1,
};

export function buildWeightedFairRunOrder(
  runs: Array<{
    runId: string;
    priority: SupervisorRunPriority;
    runnableCount: number;
    createdAt: string;
  }>,
  maxDispatches = Number.POSITIVE_INFINITY
): string[] {
  const remaining = new Map(
    runs.map((run) => [run.runId, Math.max(0, run.runnableCount)])
  );
  const ordered = [...runs].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.runId.localeCompare(right.runId)
  );
  const result: string[] = [];
  const maxWeight = Math.max(
    0,
    ...ordered.map((run) => SUPERVISOR_PRIORITY_WEIGHTS[run.priority])
  );
  for (let round = 0; round < maxWeight; round += 1) {
    for (const run of ordered) {
      if (result.length >= maxDispatches) {
        return result;
      }
      if (SUPERVISOR_PRIORITY_WEIGHTS[run.priority] <= round) {
        continue;
      }
      const available = remaining.get(run.runId) ?? 0;
      if (available <= 0) {
        continue;
      }
      result.push(run.runId);
      remaining.set(run.runId, available - 1);
    }
  }
  return result;
}

export class SupervisorGlobalSchedulerService {
  private readonly deps: {
    runs: SupervisorRunRepositoryPort;
    now?: () => string;
    orchestrator: {
      schedule(
        runId: string,
        userId: string,
        maxDispatches?: number
      ): Promise<SupervisorRunState>;
    };
  };

  constructor(deps: {
    runs: SupervisorRunRepositoryPort;
    now?: () => string;
    orchestrator: {
      schedule(
        runId: string,
        userId: string,
        maxDispatches?: number
      ): Promise<SupervisorRunState>;
    };
  }) {
    this.deps = deps;
  }

  async tick(maxDispatches = 64): Promise<string[]> {
    const now = this.deps.now?.() ?? new Date().toISOString();
    const runnableRuns = (await this.deps.runs.listNonTerminal())
      .map((run) => ({
        run,
        decision: evaluateSupervisorSchedule(run, now),
      }))
      .filter(
        ({ run, decision }) =>
          isSupervisorRunDispatchable(run, now) &&
          decision.dispatchTaskIds.length > 0
      );
    const byId = new Map(
      runnableRuns.map(({ run }) => [run.runId, run] as const)
    );
    const order = buildWeightedFairRunOrder(
      runnableRuns.map(({ run, decision }) => ({
        runId: run.runId,
        priority: run.priority,
        runnableCount: decision.dispatchTaskIds.length,
        createdAt: run.createdAt,
      })),
      maxDispatches
    );
    for (const runId of order) {
      const run = byId.get(runId);
      if (run) {
        await this.deps.orchestrator.schedule(run.runId, run.userId, 1);
      }
    }
    return order;
  }
}
