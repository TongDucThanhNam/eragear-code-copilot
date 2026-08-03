import { z } from "zod";
import {
  SUPERVISOR_RUN_LIMIT_CAPS,
  SupervisorRunLimitsSchema,
  SupervisorTaskExecutionModeSchema,
  SupervisorTaskRoleSchema,
} from "../../domain/supervisor-run.schemas";

const PlannerIdentifierSchema = z.string().trim().min(1).max(160);

export const SupervisorPlannerTaskProposalSchema = z
  .object({
    taskId: PlannerIdentifierSchema,
    title: z.string().trim().min(1).max(240),
    goal: z.string().trim().min(1).max(8000),
    role: SupervisorTaskRoleSchema,
    executionMode: SupervisorTaskExecutionModeSchema,
    dependencies: z
      .array(PlannerIdentifierSchema)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
    candidateAgentId: PlannerIdentifierSchema.optional(),
    scopeIntent: z.array(z.string().trim().min(1).max(1024)).max(4096),
    verificationRequirements: z
      .array(z.string().trim().min(1).max(1000))
      .max(64),
  })
  .strict();

export const SupervisorPlannerProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: z.string().trim().min(1).max(4000),
    tasks: z
      .array(SupervisorPlannerTaskProposalSchema)
      .min(1)
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
  })
  .strict();

export const SupervisorPlannerAgentSchema = z
  .object({
    agentId: PlannerIdentifierSchema,
    displayName: z.string().trim().min(1).max(240),
    active: z.boolean(),
    roles: z.array(SupervisorTaskRoleSchema).min(1),
  })
  .strict();

export const SupervisorPlannerContextSchema = z
  .object({
    runId: PlannerIdentifierSchema,
    originalIntent: z.string().trim().min(1).max(32_000),
    constraints: z.array(z.string().trim().min(1).max(4000)).max(128),
    projectRoot: z.string().trim().min(1).max(4096),
    limits: SupervisorRunLimitsSchema,
    agents: z.array(SupervisorPlannerAgentSchema).min(1).max(128),
    projectIndexSummary: z.string().max(16_000).optional(),
    scopeResolutionSummary: z.string().max(16_000).optional(),
    completedTaskSummaries: z
      .array(
        z
          .object({
            taskId: PlannerIdentifierSchema,
            summary: z.string().trim().min(1).max(4000),
          })
          .strict()
      )
      .max(SUPERVISOR_RUN_LIMIT_CAPS.maxTasks),
  })
  .strict();

export const SupervisorPlannerPolicySchema = z
  .object({
    trustedVerificationCommandsByRole: z.record(
      SupervisorTaskRoleSchema,
      z.array(z.string().trim().min(1).max(4096)).max(32)
    ),
    defaultAgentIdByRole: z
      .object({
        research: PlannerIdentifierSchema.optional(),
        implementation: PlannerIdentifierSchema.optional(),
        test: PlannerIdentifierSchema.optional(),
        review: PlannerIdentifierSchema.optional(),
        integration: PlannerIdentifierSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type SupervisorPlannerTaskProposal = z.infer<
  typeof SupervisorPlannerTaskProposalSchema
>;
export type SupervisorPlannerProposal = z.infer<
  typeof SupervisorPlannerProposalSchema
>;
export type SupervisorPlannerAgent = z.infer<
  typeof SupervisorPlannerAgentSchema
>;
export type SupervisorPlannerContext = z.infer<
  typeof SupervisorPlannerContextSchema
>;
export type SupervisorPlannerPolicy = z.infer<
  typeof SupervisorPlannerPolicySchema
>;
