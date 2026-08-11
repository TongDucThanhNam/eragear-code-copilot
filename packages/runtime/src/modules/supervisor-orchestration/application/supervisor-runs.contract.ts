import { z } from "zod";
import { SupervisorRunPrioritySchema } from "../domain/supervisor-run.schemas";

const RunIdSchema = z.string().trim().min(1).max(160);

export const CreateSupervisorRunDraftInputSchema = z
  .object({
    projectId: z.string().trim().min(1).max(160),
    intent: z.string().trim().min(1).max(32_000),
    constraints: z
      .array(z.string().trim().min(1).max(4000))
      .max(128)
      .optional(),
    priority: SupervisorRunPrioritySchema.optional(),
    agentAllowlist: z
      .array(z.string().trim().min(1).max(160))
      .min(1)
      .max(32)
      .optional(),
  })
  .strict();

/** Compatibility alias retained for one public schema version. */
export const StartSupervisorRunInputSchema =
  CreateSupervisorRunDraftInputSchema;

export const SupervisorRunIdInputSchema = z
  .object({ runId: RunIdSchema })
  .strict();

export const ListSupervisorRunsInputSchema = z
  .object({
    projectId: z.string().trim().min(1).max(160).optional(),
    includeTerminal: z.boolean().optional(),
  })
  .strict()
  .optional();

export const SupervisorRunGateInputSchema = z
  .object({
    runId: RunIdSchema,
    gateId: z.string().trim().min(1).max(160),
  })
  .strict();

export const SupervisorRunTaskInputSchema = z
  .object({
    runId: RunIdSchema,
    taskId: z.string().trim().min(1).max(160),
  })
  .strict();

export const ApproveSupervisorPlanInputSchema = z
  .object({
    runId: RunIdSchema,
    planVersion: z.number().int().min(1),
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const RequestSupervisorPlanChangesInputSchema = z
  .object({
    runId: RunIdSchema,
    requestedChanges: z.string().trim().min(1).max(8000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const AnswerSupervisorDecisionInputSchema = z
  .object({
    runId: RunIdSchema,
    decisionId: z.string().trim().min(1).max(160),
    answer: z.string().trim().min(1).max(8000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const SetSupervisorRunPriorityInputSchema = z
  .object({
    runId: RunIdSchema,
    priority: SupervisorRunPrioritySchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const SupervisorRunUpdatesInputSchema = z
  .object({ projectId: z.string().trim().min(1).max(160).optional() })
  .strict()
  .optional();

export const SupervisorManagerInboxInputSchema = z
  .object({
    projectId: z.string().trim().min(1).max(160).optional(),
    includeResolved: z.boolean().optional(),
  })
  .strict()
  .optional();

export const ConfigureSupervisorTelegramInputSchema = z
  .object({
    botToken: z.string().trim().min(20).max(256),
    timezone: z.string().trim().min(1).max(120),
  })
  .strict();
