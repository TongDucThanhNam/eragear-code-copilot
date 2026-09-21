import { z } from "zod";
import {
  type SupervisorRunState,
  SupervisorRunStateSchema,
} from "../../../supervisor-orchestration/domain/supervisor-run.schemas";
import {
  type AppendWorkflowJournalResult,
  WorkflowEffectIntentInputSchema,
  type WorkflowEffectRecord,
  WorkflowEventInputSchema,
  WorkflowJsonValueSchema,
} from "./workflow-journal.contract";

const IdentifierSchema = z.string().trim().min(1).max(200);
const TimestampMsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const SupervisorWorkflowTransitionSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().nullable(),
    snapshot: SupervisorRunStateSchema,
    event: WorkflowEventInputSchema,
    effects: z.array(WorkflowEffectIntentInputSchema).max(4096).default([]),
  })
  .strict()
  .superRefine(validateSupervisorWorkflowTransition);

export const CommitSupervisorRunTransitionInputSchema =
  SupervisorWorkflowTransitionSchema;

export const WorkflowEffectTerminalizationSchema = z
  .object({
    effectId: IdentifierSchema,
    claimToken: IdentifierSchema,
    status: z.enum(["succeeded", "failed", "uncertain"]),
    finishedAtMs: TimestampMsSchema,
    error: WorkflowJsonValueSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "succeeded" && value.error !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Succeeded effects cannot record an error",
      });
    }
    if (value.status !== "succeeded" && value.error === undefined) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: `${value.status} effects require an error`,
      });
    }
  });

export const CommitWorkflowEffectResultInputSchema = z
  .object({
    transition: SupervisorWorkflowTransitionSchema,
    terminalEffect: WorkflowEffectTerminalizationSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.transition.expectedRevision === null) {
      context.addIssue({
        code: "custom",
        path: ["transition", "expectedRevision"],
        message: "An effect result cannot create a Supervisor run",
      });
    }
  });

export const CancelPendingWorkflowEffectsInputSchema = z
  .object({
    runId: IdentifierSchema,
    authorityId: IdentifierSchema,
    cancelledAtMs: TimestampMsSchema,
    reason: WorkflowJsonValueSchema.optional(),
  })
  .strict();

export type CommitSupervisorRunTransitionInput = z.input<
  typeof CommitSupervisorRunTransitionInputSchema
>;
export type CommitWorkflowEffectResultInput = z.input<
  typeof CommitWorkflowEffectResultInputSchema
>;
export type CancelPendingWorkflowEffectsInput = z.infer<
  typeof CancelPendingWorkflowEffectsInputSchema
>;
export type WorkflowEffectTerminalization = z.infer<
  typeof WorkflowEffectTerminalizationSchema
>;

export interface CommitSupervisorRunTransitionResult
  extends AppendWorkflowJournalResult {
  snapshot: SupervisorRunState;
  created: boolean;
  previousRevision: number | null;
  committedRevision: number;
}

export interface CommitWorkflowEffectResultResult
  extends CommitSupervisorRunTransitionResult {
  effect: WorkflowEffectRecord;
}

function validateSupervisorWorkflowTransition(
  value: {
    expectedRevision: number | null;
    snapshot: SupervisorRunState;
    event: { runId: string; revision: number; occurredAtMs: number };
  },
  context: z.RefinementCtx
): void {
  const nextRevision =
    value.expectedRevision === null ? 0 : value.expectedRevision + 1;
  if (value.snapshot.revision !== nextRevision) {
    context.addIssue({
      code: "custom",
      path: ["snapshot", "revision"],
      message: "Snapshot revision must be exactly expectedRevision + 1",
    });
  }
  if (
    value.event.runId !== value.snapshot.runId ||
    value.event.revision !== value.snapshot.revision
  ) {
    context.addIssue({
      code: "custom",
      path: ["event"],
      message: "Workflow event must identify the snapshot run and revision",
    });
  }
  if (Date.parse(value.snapshot.updatedAt) !== value.event.occurredAtMs) {
    context.addIssue({
      code: "custom",
      path: ["event", "occurredAtMs"],
      message: "Workflow event time must equal the snapshot update time",
    });
  }
}
