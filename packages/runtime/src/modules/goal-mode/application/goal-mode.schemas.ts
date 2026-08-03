import { z } from "zod";
import { ScopeResolutionSchema } from "#runtime/modules/scope-resolution";

export const GateReasonSchema = z.enum([
  "scope_drift_modified",
  "scope_drift_created",
  "file_deleted",
  "destructive_action",
  "verification_failed",
]);

export const GateResultSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("auto_continue"),
      reasons: z.tuple([]),
    })
    .strict(),
  z
    .object({
      decision: z.literal("needs_user"),
      reasons: z.array(GateReasonSchema).min(1),
    })
    .strict(),
]);

export const PhaseAttemptRecordSchema = z
  .object({
    attemptId: z.string().min(1),
    chatId: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().min(1).optional(),
    supervisorFinalState: z
      .object({
        status: z.enum(["done", "needs_user", "aborted", "error"]),
        continuationCount: z.number().int().nonnegative(),
        reason: z.string().optional(),
      })
      .strict()
      .optional(),
    filesTouched: z.array(z.string()),
    filesCreated: z.array(z.string()),
    filesDeleted: z.array(z.string()),
    verification: z
      .object({
        command: z.string().min(1),
        exitCode: z.number().int().nullable(),
      })
      .strict()
      .optional(),
    gate: GateResultSchema.optional(),
  })
  .strict();

export const GoalModeOutcomeSummarySchema = z
  .object({
    keyDecision: z.string().min(1).max(2000),
    filesChanged: z.array(z.string()),
    gotcha: z.string().max(2000),
    verification: z.string().max(2000),
  })
  .strict();

export const PhaseRecordSchema = z
  .object({
    phaseId: z.string().min(1),
    goal: z.string().min(1),
    filesAllowed: z.array(z.string()),
    scopeResolution: ScopeResolutionSchema,
    attempts: z.array(PhaseAttemptRecordSchema),
    outcomeSummary: GoalModeOutcomeSummarySchema.optional(),
    decision: z.enum([
      "pending",
      "auto_continue",
      "needs_user",
      "user_rejected",
    ]),
    verificationCommand: z.string().min(1).optional(),
  })
  .strict();

export const SupervisorGoalStateSchema = z
  .object({
    goalId: z.string().min(1),
    userId: z.string().min(1),
    originalIntent: z.string().min(1),
    constraints: z.array(z.string()),
    currentPhaseId: z.string().min(1),
    phases: z.array(PhaseRecordSchema),
  })
  .strict();

export type GateReason = z.infer<typeof GateReasonSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type PhaseAttemptRecord = z.infer<typeof PhaseAttemptRecordSchema>;
export type GoalModeOutcomeSummary = z.infer<
  typeof GoalModeOutcomeSummarySchema
>;
export type PhaseRecord = z.infer<typeof PhaseRecordSchema>;
export type SupervisorGoalState = z.infer<typeof SupervisorGoalStateSchema>;
