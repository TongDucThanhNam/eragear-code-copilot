import { callSqliteWorker } from "#runtime/platform/storage/sqlite-worker-client";
import type {
  CancelPendingWorkflowEffectsInput,
  CommitSupervisorRunTransitionInput,
  CommitSupervisorRunTransitionResult,
  CommitWorkflowEffectResultInput,
  CommitWorkflowEffectResultResult,
} from "../application/contracts/supervisor-workflow-unit-of-work.contract";
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
} from "../application/contracts/workflow-journal.contract";
import type { SupervisorWorkflowUnitOfWorkPort } from "../application/ports/supervisor-workflow-unit-of-work.port";
import type { WorkflowJournalPort } from "../application/ports/workflow-journal.port";

export class WorkflowJournalSqliteWorkerAdapter
  implements WorkflowJournalPort, SupervisorWorkflowUnitOfWorkPort
{
  append(
    input: AppendWorkflowJournalInput
  ): Promise<AppendWorkflowJournalResult> {
    return callSqliteWorker("workflowJournal", "append", [input]);
  }

  commitRunTransition(
    input: CommitSupervisorRunTransitionInput
  ): Promise<CommitSupervisorRunTransitionResult> {
    return callSqliteWorker("workflowJournal", "commitRunTransition", [input]);
  }

  commitEffectResult(
    input: CommitWorkflowEffectResultInput
  ): Promise<CommitWorkflowEffectResultResult> {
    return callSqliteWorker("workflowJournal", "commitEffectResult", [input]);
  }

  cancelPendingEffects(
    input: CancelPendingWorkflowEffectsInput
  ): Promise<WorkflowEffectRecord[]> {
    return callSqliteWorker("workflowJournal", "cancelPendingEffects", [input]);
  }

  getEvent(eventId: string): Promise<WorkflowEventRecord | null> {
    return callSqliteWorker("workflowJournal", "getEvent", [eventId]);
  }

  listEvents(runId: string): Promise<WorkflowEventRecord[]> {
    return callSqliteWorker("workflowJournal", "listEvents", [runId]);
  }

  getEffect(effectId: string): Promise<WorkflowEffectRecord | null> {
    return callSqliteWorker("workflowJournal", "getEffect", [effectId]);
  }

  listEffects(runId: string): Promise<WorkflowEffectRecord[]> {
    return callSqliteWorker("workflowJournal", "listEffects", [runId]);
  }

  claimDueEffects(
    input: ClaimDueWorkflowEffectsInput
  ): Promise<WorkflowEffectRecord[]> {
    return callSqliteWorker("workflowJournal", "claimDueEffects", [input]);
  }

  markEffectStarted(
    input: MarkWorkflowEffectStartedInput
  ): Promise<WorkflowEffectRecord | null> {
    return callSqliteWorker("workflowJournal", "markEffectStarted", [input]);
  }

  markEffectSucceeded(
    input: MarkWorkflowEffectSucceededInput
  ): Promise<WorkflowEffectRecord | null> {
    return callSqliteWorker("workflowJournal", "markEffectSucceeded", [input]);
  }

  markEffectFailed(
    input: MarkWorkflowEffectFailedInput
  ): Promise<WorkflowEffectRecord | null> {
    return callSqliteWorker("workflowJournal", "markEffectFailed", [input]);
  }

  markEffectUncertain(
    input: MarkWorkflowEffectUncertainInput
  ): Promise<WorkflowEffectRecord | null> {
    return callSqliteWorker("workflowJournal", "markEffectUncertain", [input]);
  }

  markStaleStartedDispatchesUncertain(
    input: MarkStaleWorkflowDispatchesUncertainInput
  ): Promise<WorkflowEffectRecord[]> {
    return callSqliteWorker(
      "workflowJournal",
      "markStaleStartedDispatchesUncertain",
      [input]
    );
  }

  releasePendingEffectClaims(
    input: ReleasePendingWorkflowEffectClaimsInput
  ): Promise<WorkflowEffectRecord[]> {
    return callSqliteWorker("workflowJournal", "releasePendingEffectClaims", [
      input,
    ]);
  }
}
