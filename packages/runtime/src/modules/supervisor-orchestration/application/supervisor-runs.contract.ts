import { z } from "zod";
import { SUPERVISOR_RUN_LIMIT_CAPS } from "../domain/supervisor-run.schemas";

const RunIdSchema = z.string().trim().min(1).max(160);

export const StartSupervisorRunInputSchema = z
  .object({
    projectId: z.string().trim().min(1).max(160),
    projectRoot: z.string().trim().min(1).max(4096),
    originatingChatId: z.string().trim().min(1).max(160).optional(),
    originalIntent: z.string().trim().min(1).max(32_000),
    constraints: z
      .array(z.string().trim().min(1).max(4000))
      .max(128)
      .optional(),
    limits: z
      .object({
        maxConcurrency: z
          .number()
          .int()
          .min(1)
          .max(SUPERVISOR_RUN_LIMIT_CAPS.maxConcurrency)
          .optional(),
        maxTasks: z
          .number()
          .int()
          .min(1)
          .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks)
          .optional(),
        maxAttemptsPerTask: z
          .number()
          .int()
          .min(1)
          .max(SUPERVISOR_RUN_LIMIT_CAPS.maxAttemptsPerTask)
          .optional(),
        maxRunDurationMs: z
          .number()
          .int()
          .min(1)
          .max(SUPERVISOR_RUN_LIMIT_CAPS.maxRunDurationMs)
          .optional(),
        maxPlannerReplans: z
          .number()
          .int()
          .min(0)
          .max(SUPERVISOR_RUN_LIMIT_CAPS.maxPlannerReplans)
          .optional(),
      })
      .strict()
      .optional(),
    projectIndexSummary: z.string().trim().min(1).max(12_000).optional(),
    scopeResolutionSummary: z.string().trim().min(1).max(12_000).optional(),
    eligibleAgentIds: z
      .array(z.string().trim().min(1).max(160))
      .min(1)
      .max(32)
      .optional(),
    workerModelId: z.string().trim().min(1).max(512).optional(),
    providerId: z.string().trim().min(1).max(160).optional(),
    scheduleId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

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

export const SupervisorRunUpdatesInputSchema = z
  .object({ projectId: z.string().trim().min(1).max(160).optional() })
  .strict()
  .optional();
