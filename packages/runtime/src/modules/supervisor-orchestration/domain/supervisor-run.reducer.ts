import { z } from "zod";
import { projectSupervisorCompatibilityStatuses } from "./supervisor-run.projections";
import {
  isActiveSupervisorAttemptStatus,
  SupervisorRunDesiredStateSchema,
  SupervisorRunOutcomeSchema,
  SupervisorRunPhaseSchema,
  type SupervisorRunState,
  SupervisorRunStateSchema,
  SupervisorTaskActivitySchema,
  type SupervisorTaskRecord,
  SupervisorWorkerAttemptSchema,
  SupervisorWorkerResultSchema,
  SupervisorWorkflowAcceptanceSchema,
  SupervisorWorkflowCancellationSchema,
  SupervisorWorkflowCapacityLeaseSchema,
  SupervisorWorkflowDispatchSchema,
  SupervisorWorkflowFinalizationSchema,
  SupervisorWorkflowIntegrationSchema,
  SupervisorWorkflowPlanSchema,
  SupervisorWorkflowVerificationSchema,
} from "./supervisor-run.schemas";

const DurableEventBaseSchema = z
  .object({
    eventId: z.string().trim().min(1).max(160),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const SupervisorRunDurableEventSchema = z.discriminatedUnion("type", [
  DurableEventBaseSchema.extend({
    type: z.literal("run_desired_state_set"),
    desiredState: SupervisorRunDesiredStateSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("run_phase_set"),
    phase: SupervisorRunPhaseSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("run_outcome_recorded"),
    outcome: SupervisorRunOutcomeSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("run_blocking_decision_set"),
    decisionId: z.string().trim().min(1).max(160).nullable(),
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("workflow_plan_set"),
    plan: SupervisorWorkflowPlanSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("run_final_verification_set"),
    verification: SupervisorWorkflowVerificationSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("run_cancellation_set"),
    cancellation: SupervisorWorkflowCancellationSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("run_finalization_set"),
    finalization: SupervisorWorkflowFinalizationSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_activity_set"),
    taskId: z.string().trim().min(1).max(160),
    activity: SupervisorTaskActivitySchema.nullable(),
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_attempt_started"),
    taskId: z.string().trim().min(1).max(160),
    attempt: SupervisorWorkerAttemptSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_dispatch_set"),
    taskId: z.string().trim().min(1).max(160),
    dispatch: SupervisorWorkflowDispatchSchema.nullable(),
    capacityLease: SupervisorWorkflowCapacityLeaseSchema.nullable(),
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_attempt_uncertain"),
    taskId: z.string().trim().min(1).max(160),
    attemptId: z.string().trim().min(1).max(160),
    uncertaintyId: z.string().trim().min(1).max(160),
    dispatchEffectId: z.string().trim().min(1).max(160),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_verification_set"),
    taskId: z.string().trim().min(1).max(160),
    verification: SupervisorWorkflowVerificationSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_integration_set"),
    taskId: z.string().trim().min(1).max(160),
    integration: SupervisorWorkflowIntegrationSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_acceptance_set"),
    taskId: z.string().trim().min(1).max(160),
    acceptance: SupervisorWorkflowAcceptanceSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_deferred"),
    taskId: z.string().trim().min(1).max(160),
    notBefore: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_blocking_decision_set"),
    taskId: z.string().trim().min(1).max(160),
    decisionId: z.string().trim().min(1).max(160).nullable(),
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("work_item_outcome_recorded"),
    taskId: z.string().trim().min(1).max(160),
    outcome: SupervisorRunOutcomeSchema,
  }).strict(),
  DurableEventBaseSchema.extend({
    type: z.literal("agent_result_recorded"),
    taskId: z.string().trim().min(1).max(160),
    attemptId: z.string().trim().min(1).max(160),
    result: SupervisorWorkerResultSchema,
  }).strict(),
]);

export type SupervisorRunDurableEvent = z.infer<
  typeof SupervisorRunDurableEventSchema
>;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keeping the exhaustive durable-event switch together makes reducer behavior auditable.
export function reduceSupervisorRun(
  previous: SupervisorRunState,
  input: SupervisorRunDurableEvent
): SupervisorRunState {
  const current = SupervisorRunStateSchema.parse(previous);
  const event = SupervisorRunDurableEventSchema.parse(input);
  if (current.processedEventIds.includes(event.eventId)) {
    return current;
  }
  if (current.outcome) {
    throw new Error(`Supervisor run ${current.runId} is already terminal`);
  }

  const draft = structuredClone(current);
  switch (event.type) {
    case "run_desired_state_set":
      draft.desiredState = event.desiredState;
      break;
    case "run_phase_set":
      if (event.phase === "finished" && !draft.outcome) {
        throw new Error("A run cannot finish without a recorded outcome");
      }
      draft.phase = event.phase;
      synchronizeRunActivityWithPhase(draft);
      break;
    case "run_outcome_recorded":
      assertRunCanRecordOutcome(draft, event.outcome);
      draft.outcome = event.outcome;
      draft.phase = "finished";
      if (event.outcome === "cancelled") {
        draft.desiredState = "cancelled";
      }
      clearOptionalProperty(draft, "activity");
      clearOptionalProperty(draft, "blockingDecisionId");
      break;
    case "run_blocking_decision_set":
      setOptionalString(draft, "blockingDecisionId", event.decisionId);
      break;
    case "workflow_plan_set":
      draft.workflowPlan = structuredClone(event.plan);
      break;
    case "run_final_verification_set":
      draft.workflowFinalVerification = structuredClone(event.verification);
      break;
    case "run_cancellation_set":
      draft.cancellation = structuredClone(event.cancellation);
      break;
    case "run_finalization_set":
      draft.finalization = structuredClone(event.finalization);
      break;
    case "work_item_activity_set": {
      const task = requireOpenTask(draft, event.taskId);
      if (event.activity) {
        task.activity = event.activity;
      } else {
        clearOptionalProperty(task, "activity");
      }
      break;
    }
    case "work_item_attempt_started": {
      const task = requireOpenTask(draft, event.taskId);
      if (task.activeAttemptId) {
        throw new Error(`Task ${task.taskId} already has an active attempt`);
      }
      if (
        event.attempt.status !== "starting" &&
        event.attempt.status !== "running" &&
        event.attempt.status !== "waiting_capacity"
      ) {
        throw new Error("A started attempt must have a dispatchable status");
      }
      task.attempts.push(structuredClone(event.attempt));
      task.activeAttemptId = event.attempt.attemptId;
      task.activity =
        event.attempt.status === "waiting_capacity"
          ? "capacity_wait"
          : "agent_turn";
      clearOptionalProperty(task, "blockingDecisionId");
      clearOptionalProperty(task, "notBefore");
      draft.phase = "executing";
      draft.activity = "executing";
      break;
    }
    case "work_item_dispatch_set": {
      const task = requireOpenTask(draft, event.taskId);
      setOptionalObject(task, "dispatch", event.dispatch);
      setOptionalObject(task, "capacityLease", event.capacityLease);
      task.activity =
        event.dispatch?.state === "capacity_requested"
          ? "capacity_wait"
          : "dispatching";
      break;
    }
    case "work_item_attempt_uncertain": {
      const task = requireOpenTask(draft, event.taskId);
      const attempt = requireActiveAttempt(task, event.attemptId);
      attempt.status = "uncertain";
      attempt.uncertaintyId = event.uncertaintyId;
      attempt.dispatchEffectId = event.dispatchEffectId;
      attempt.promptHash = event.promptHash;
      task.activity = "agent_turn";
      break;
    }
    case "work_item_verification_set": {
      const task = requireOpenTask(draft, event.taskId);
      task.verification = structuredClone(event.verification);
      task.activity = "verification";
      break;
    }
    case "work_item_integration_set": {
      const task = requireOpenTask(draft, event.taskId);
      task.integration = structuredClone(event.integration);
      task.activity = "integration";
      break;
    }
    case "work_item_acceptance_set": {
      const task = requireOpenTask(draft, event.taskId);
      task.acceptance = event.acceptance;
      break;
    }
    case "work_item_deferred": {
      const task = requireOpenTask(draft, event.taskId);
      setOptionalString(task, "notBefore", event.notBefore);
      break;
    }
    case "work_item_blocking_decision_set": {
      const task = requireOpenTask(draft, event.taskId);
      setOptionalString(task, "blockingDecisionId", event.decisionId);
      break;
    }
    case "work_item_outcome_recorded": {
      const task = requireOpenTask(draft, event.taskId);
      if (hasActiveAttempt(task)) {
        throw new Error(`Task ${task.taskId} still has an active attempt`);
      }
      if (
        event.outcome === "succeeded" &&
        !task.attempts.some(
          (attempt) =>
            attempt.status === "terminal" &&
            attempt.result?.semanticStatus === "succeeded"
        )
      ) {
        throw new Error(
          `Task ${task.taskId} cannot succeed without a terminal successful agent result`
        );
      }
      if (
        event.outcome === "succeeded" &&
        (!task.acceptance || task.acceptance === "pending")
      ) {
        throw new Error(
          `Task ${task.taskId} cannot succeed without explicit acceptance`
        );
      }
      if (
        event.outcome === "succeeded" &&
        task.executionMode === "write" &&
        task.integration?.status !== "succeeded"
      ) {
        throw new Error(
          `Write task ${task.taskId} cannot succeed before integration`
        );
      }
      task.outcome = event.outcome;
      clearOptionalProperty(task, "activity");
      clearOptionalProperty(task, "blockingDecisionId");
      clearOptionalProperty(task, "notBefore");
      break;
    }
    case "agent_result_recorded": {
      const task = requireOpenTask(draft, event.taskId);
      const attempt = task.attempts.find(
        (candidate) => candidate.attemptId === event.attemptId
      );
      if (!attempt) {
        throw new Error(`Unknown attempt: ${event.attemptId}`);
      }
      if (
        !isActiveSupervisorAttemptStatus(attempt.status) ||
        task.activeAttemptId !== attempt.attemptId
      ) {
        throw new Error(`Attempt ${event.attemptId} is not active`);
      }
      attempt.status = "terminal";
      attempt.finishedAt = event.result.finishedAt;
      attempt.result = structuredClone(event.result);
      clearOptionalProperty(attempt, "uncertaintyId");
      clearOptionalProperty(attempt, "retryAt");
      clearOptionalProperty(task, "activeAttemptId");
      task.activity = "verification";
      break;
    }
    default:
      return assertUnreachable(event);
  }

  draft.processedEventIds.push(event.eventId);
  draft.revision = current.revision + 1;
  draft.updatedAt = event.occurredAt;
  projectSupervisorCompatibilityStatuses(draft, event.occurredAt);
  return SupervisorRunStateSchema.parse(draft);
}

function synchronizeRunActivityWithPhase(run: SupervisorRunState): void {
  if (run.phase === "planning") {
    run.activity = "planning";
  } else if (run.phase === "executing") {
    run.activity ??= "dispatching";
  } else if (run.phase === "finalizing") {
    run.activity = "finalizing";
  } else {
    clearOptionalProperty(run, "activity");
  }
}

function requireTask(
  run: SupervisorRunState,
  taskId: string
): SupervisorTaskRecord {
  const task = run.tasks.find((candidate) => candidate.taskId === taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }
  return task;
}

function requireOpenTask(
  run: SupervisorRunState,
  taskId: string
): SupervisorTaskRecord {
  const task = requireTask(run, taskId);
  if (task.outcome) {
    throw new Error(`Task ${taskId} is already terminal`);
  }
  return task;
}

function assertRunCanRecordOutcome(
  run: SupervisorRunState,
  outcome: "succeeded" | "failed" | "cancelled"
): void {
  const activeTask = run.tasks.find(hasActiveAttempt);
  if (activeTask) {
    throw new Error(
      `Supervisor run ${run.runId} cannot finish while task ${activeTask.taskId} has an active attempt`
    );
  }
  if (
    outcome === "succeeded" &&
    run.tasks.some((task) => task.outcome !== "succeeded")
  ) {
    throw new Error(
      `Supervisor run ${run.runId} cannot succeed before every task succeeds`
    );
  }
  if (
    outcome === "succeeded" &&
    !(
      run.workflowFinalVerification?.status === "not_required" ||
      run.workflowFinalVerification?.status === "accepted" ||
      (run.workflowFinalVerification?.status === "passed" &&
        run.workflowFinalVerification.evidenceRefs.length > 0)
    )
  ) {
    throw new Error(
      `Supervisor run ${run.runId} cannot succeed without final verification acceptance`
    );
  }
}

function requireActiveAttempt(task: SupervisorTaskRecord, attemptId: string) {
  const attempt = task.attempts.find(
    (candidate) => candidate.attemptId === attemptId
  );
  if (
    !(attempt && isActiveSupervisorAttemptStatus(attempt.status)) ||
    task.activeAttemptId !== attemptId
  ) {
    throw new Error(`Attempt ${attemptId} is not active`);
  }
  return attempt;
}

function hasActiveAttempt(task: SupervisorTaskRecord): boolean {
  return task.attempts.some((attempt) =>
    isActiveSupervisorAttemptStatus(attempt.status)
  );
}

function setOptionalString<TObject extends object, TKey extends keyof TObject>(
  object: TObject,
  key: TKey,
  value: string | null
): void {
  if (value) {
    object[key] = value as TObject[TKey];
  } else {
    clearOptionalProperty(object, key);
  }
}

function setOptionalObject<TObject extends object, TKey extends keyof TObject>(
  object: TObject,
  key: TKey,
  value: TObject[TKey] | null
): void {
  if (value) {
    object[key] = structuredClone(value);
  } else {
    clearOptionalProperty(object, key);
  }
}

function clearOptionalProperty(object: object, key: PropertyKey): void {
  Reflect.deleteProperty(object, key);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported supervisor durable event: ${String(value)}`);
}
