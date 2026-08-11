import type { ScheduledWorkDecisionPort } from "../application/ports/scheduled-work-decision.port";
import type { SupervisorDecisionPort } from "../application/ports/supervisor-decision.port";

/** Legacy per-session autonomy is disabled in Manager Mode v2. */
export class ManagerModeSupervisorDecisionAdapter
  implements SupervisorDecisionPort
{
  decideTurn(): Promise<never> {
    return Promise.reject(
      new Error("Per-session Supervisor decisions are owned by the ACP manager")
    );
  }

  decidePermission(): Promise<{
    action: "reject";
    reason: string;
  }> {
    return Promise.resolve({
      action: "reject",
      reason:
        "Permission is outside the approved Manager Mode execution envelope",
    });
  }
}

/** Scheduled work enters the Goal API; its sticky ACP manager performs planning. */
export class GoalDraftScheduledWorkDecisionAdapter
  implements ScheduledWorkDecisionPort
{
  decide(input: Parameters<ScheduledWorkDecisionPort["decide"]>[0]) {
    return Promise.resolve({
      action: "dispatch" as const,
      prompt: input.objective,
      rationale: "Scheduled objective delegated to the Manager Mode Goal API",
      evidenceSummary:
        "Planning, scope, and delivery decisions are deferred to the sticky ACP manager",
    });
  }
}
