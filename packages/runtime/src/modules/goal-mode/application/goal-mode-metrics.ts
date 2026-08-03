import type { ResolverVersion } from "#runtime/modules/scope-resolution";
import type { GateReason, SupervisorGoalState } from "./goal-mode.schemas";

export interface GoalModeMetrics {
  phaseCount: number;
  attemptCount: number;
  avgAttemptsPerPhase: number;
  resolvedViaLLMRate: Record<ResolverVersion, number>;
  gateRejectReasons: Partial<Record<GateReason, number>>;
  signalScanSkippedBySize: number;
}

export function computeGoalMetrics(goal: SupervisorGoalState): GoalModeMetrics {
  const resolverCounts: Record<
    ResolverVersion,
    { total: number; llm: number }
  > = {
    "v0-no-graph": { total: 0, llm: 0 },
    "v1-import-graph": { total: 0, llm: 0 },
  };
  const gateRejectReasons: Partial<Record<GateReason, number>> = {};
  let attemptCount = 0;
  let signalScanSkippedBySize = 0;

  for (const phase of goal.phases) {
    const resolverVersion = phase.scopeResolution.resolverVersion;
    resolverCounts[resolverVersion].total += 1;
    if (phase.scopeResolution.resolvedViaLLM) {
      resolverCounts[resolverVersion].llm += 1;
    }
    signalScanSkippedBySize +=
      phase.scopeResolution.diagnostics.signalScanSkippedBySize;
    attemptCount += phase.attempts.length;

    for (const attempt of phase.attempts) {
      if (attempt.gate?.decision !== "needs_user") {
        continue;
      }
      for (const reason of attempt.gate.reasons) {
        gateRejectReasons[reason] = (gateRejectReasons[reason] ?? 0) + 1;
      }
    }
  }

  return {
    phaseCount: goal.phases.length,
    attemptCount,
    avgAttemptsPerPhase:
      goal.phases.length === 0 ? 0 : attemptCount / goal.phases.length,
    resolvedViaLLMRate: {
      "v0-no-graph": ratio(resolverCounts["v0-no-graph"]),
      "v1-import-graph": ratio(resolverCounts["v1-import-graph"]),
    },
    gateRejectReasons,
    signalScanSkippedBySize,
  };
}

function ratio(input: { total: number; llm: number }): number {
  return input.total === 0 ? 0 : input.llm / input.total;
}
