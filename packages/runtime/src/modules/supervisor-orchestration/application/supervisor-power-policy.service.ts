import type { SupervisorRunState } from "../domain/supervisor-run.schemas";

const LONG_CAPACITY_WAIT_MS = 30 * 60 * 1000;

export interface SupervisorPowerPolicyDecision {
  holdInhibitor: boolean;
  reason:
    | "active_work"
    | "short_capacity_wait"
    | "long_capacity_wait"
    | "battery"
    | "idle";
  wakeAt?: string;
}

const ACTIVE_WORK_STATUSES = new Set<SupervisorRunState["status"]>([
  "planning",
  "queued",
  "running",
  "completing",
]);

export function evaluateSupervisorPowerPolicy(input: {
  runs: SupervisorRunState[];
  onAcPower: boolean;
  now?: Date;
}): SupervisorPowerPolicyDecision {
  if (!input.onAcPower) {
    return { holdInhibitor: false, reason: "battery" };
  }
  const nonTerminal = input.runs.filter(
    (run) =>
      run.status !== "completed" &&
      run.status !== "failed" &&
      run.status !== "cancelled"
  );
  if (nonTerminal.some((run) => ACTIVE_WORK_STATUSES.has(run.status))) {
    return { holdInhibitor: true, reason: "active_work" };
  }

  const waits = nonTerminal.flatMap((run) => run.capacityWaits);
  if (waits.length === 0) {
    return { holdInhibitor: false, reason: "idle" };
  }
  const nowMs = (input.now ?? new Date()).getTime();
  const earliestRetryMs = Math.min(
    ...waits.map((wait) => new Date(wait.retryAt).getTime())
  );
  if (earliestRetryMs - nowMs <= LONG_CAPACITY_WAIT_MS) {
    return { holdInhibitor: true, reason: "short_capacity_wait" };
  }
  return {
    holdInhibitor: false,
    reason: "long_capacity_wait",
    wakeAt: new Date(earliestRetryMs).toISOString(),
  };
}
