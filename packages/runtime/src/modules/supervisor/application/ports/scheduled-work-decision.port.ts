import type {
  ScheduledWorkDecisionProposal,
  ScheduledWorkDecisionSnapshot,
} from "../scheduled-work-decision.contract";

export interface ScheduledWorkDecisionPort {
  decide(
    input: ScheduledWorkDecisionSnapshot
  ): Promise<ScheduledWorkDecisionProposal>;
}
