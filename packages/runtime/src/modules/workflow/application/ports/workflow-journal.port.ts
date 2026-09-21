import type {
  AppendWorkflowJournalInput,
  AppendWorkflowJournalResult,
  ClaimDueWorkflowEffectsInput,
  MarkStaleWorkflowDispatchesUncertainInput,
  MarkWorkflowEffectFailedInput,
  MarkWorkflowEffectStartedInput,
  MarkWorkflowEffectSucceededInput,
  MarkWorkflowEffectUncertainInput,
  ReleasePendingWorkflowEffectClaimsInput,
  WorkflowEffectRecord,
  WorkflowEventRecord,
} from "../contracts/workflow-journal.contract";

export interface WorkflowJournalPort {
  append(
    input: AppendWorkflowJournalInput
  ): Promise<AppendWorkflowJournalResult>;
  getEvent(eventId: string): Promise<WorkflowEventRecord | null>;
  listEvents(runId: string): Promise<WorkflowEventRecord[]>;
  getEffect(effectId: string): Promise<WorkflowEffectRecord | null>;
  listEffects(runId: string): Promise<WorkflowEffectRecord[]>;
  claimDueEffects(
    input: ClaimDueWorkflowEffectsInput
  ): Promise<WorkflowEffectRecord[]>;
  markEffectStarted(
    input: MarkWorkflowEffectStartedInput
  ): Promise<WorkflowEffectRecord | null>;
  markEffectSucceeded(
    input: MarkWorkflowEffectSucceededInput
  ): Promise<WorkflowEffectRecord | null>;
  markEffectFailed(
    input: MarkWorkflowEffectFailedInput
  ): Promise<WorkflowEffectRecord | null>;
  markEffectUncertain(
    input: MarkWorkflowEffectUncertainInput
  ): Promise<WorkflowEffectRecord | null>;
  markStaleStartedDispatchesUncertain(
    input: MarkStaleWorkflowDispatchesUncertainInput
  ): Promise<WorkflowEffectRecord[]>;
  releasePendingEffectClaims(
    input: ReleasePendingWorkflowEffectClaimsInput
  ): Promise<WorkflowEffectRecord[]>;
}
