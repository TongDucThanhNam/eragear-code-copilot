import { z } from "zod";
import {
  SupervisorExecutionEnvelopeSchema,
  SupervisorManagerDecisionSchema,
} from "../../domain/supervisor-run.schemas";
import { SupervisorPlannerTaskProposalSchema } from "./supervisor-planner.contract";

const BaseTurnSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().trim().min(1).max(160).optional(),
});

const AcpManagerPlanPayloadSchema = BaseTurnSchema.extend({
  summary: z.string().trim().min(1).max(8000),
  risks: z.array(z.string().trim().min(1).max(2000)).max(64),
  tasks: z.array(SupervisorPlannerTaskProposalSchema).min(1).max(32),
  envelope: SupervisorExecutionEnvelopeSchema,
});

export const AcpManagerPlanTurnSchema = AcpManagerPlanPayloadSchema.extend({
  kind: z.literal("plan"),
}).strict();

export const AcpManagerReplanTurnSchema = AcpManagerPlanPayloadSchema.extend({
  kind: z.literal("replan"),
}).strict();

export const AcpManagerQuestionTurnSchema = BaseTurnSchema.extend({
  kind: z.literal("question"),
  decisionKind: SupervisorManagerDecisionSchema.shape.kind,
  prompt: z.string().trim().min(1).max(8000),
}).strict();

export const AcpManagerContinueTurnSchema = BaseTurnSchema.extend({
  kind: z.literal("continue"),
  taskId: z.string().trim().min(1).max(160).optional(),
  instructions: z.string().trim().min(1).max(8000),
}).strict();

export const AcpManagerCompleteTurnSchema = BaseTurnSchema.extend({
  kind: z.literal("complete"),
  summary: z.string().trim().min(1).max(8000),
}).strict();

export const AcpManagerTurnSchema = z.discriminatedUnion("kind", [
  AcpManagerPlanTurnSchema,
  AcpManagerReplanTurnSchema,
  AcpManagerQuestionTurnSchema,
  AcpManagerContinueTurnSchema,
  AcpManagerCompleteTurnSchema,
]);

export type AcpManagerTurn = z.infer<typeof AcpManagerTurnSchema>;
export type AcpManagerPlanTurn =
  | z.infer<typeof AcpManagerPlanTurnSchema>
  | z.infer<typeof AcpManagerReplanTurnSchema>;
