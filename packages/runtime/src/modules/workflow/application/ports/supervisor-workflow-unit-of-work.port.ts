import type {
  CancelPendingWorkflowEffectsInput,
  CommitSupervisorRunTransitionInput,
  CommitSupervisorRunTransitionResult,
  CommitWorkflowEffectResultInput,
  CommitWorkflowEffectResultResult,
} from "../contracts/supervisor-workflow-unit-of-work.contract";
import type { WorkflowEffectRecord } from "../contracts/workflow-journal.contract";

export interface SupervisorWorkflowUnitOfWorkPort {
  commitRunTransition(
    input: CommitSupervisorRunTransitionInput
  ): Promise<CommitSupervisorRunTransitionResult>;
  commitEffectResult(
    input: CommitWorkflowEffectResultInput
  ): Promise<CommitWorkflowEffectResultResult>;
  cancelPendingEffects(
    input: CancelPendingWorkflowEffectsInput
  ): Promise<WorkflowEffectRecord[]>;
}
