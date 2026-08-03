import { z } from "zod";
import { GoalModeOutcomeSummarySchema } from "#runtime/modules/goal-mode";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const GoalIdInputSchema = z.object({ goalId: z.string().min(1) }).strict();
const StartGoalSchema = z
  .object({
    goalId: z.string().min(1).optional(),
    originalIntent: z.string().min(1).max(32_000),
    constraints: z.array(z.string().min(1).max(4000)).max(128),
    phases: z
      .array(
        z
          .object({
            phaseId: z.string().min(1),
            goal: z.string().min(1),
            verificationCommand: z.string().min(1).optional(),
            activePathHints: z.array(z.string().min(1)).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();
const StartAttemptSchema = z
  .object({
    goalId: z.string().min(1),
    phaseId: z.string().min(1).optional(),
    chatId: z.string().min(1),
    attemptId: z.string().min(1).optional(),
  })
  .strict();
const RecordResultSchema = z
  .object({
    goalId: z.string().min(1),
    phaseId: z.string().min(1),
    attemptId: z.string().min(1),
    projectRoot: z.string().min(1).optional(),
    supervisorFinalState: z
      .object({
        status: z.enum(["done", "needs_user", "aborted", "error"]),
        continuationCount: z.number().int().nonnegative(),
        reason: z.string().optional(),
      })
      .strict(),
    filesTouched: z.array(z.string()).optional(),
    filesCreated: z.array(z.string()).optional(),
    filesDeleted: z.array(z.string()).optional(),
    verification: z
      .object({
        command: z.string().min(1),
        exitCode: z.number().int().nullable(),
      })
      .strict()
      .optional(),
    destructiveAction: z.boolean().optional(),
    outcomeSummary: GoalModeOutcomeSummarySchema,
  })
  .strict();

export const goalModeRouter = router({
  start: protectedProcedure.input(StartGoalSchema).mutation(({ input, ctx }) =>
    ctx.useCases.goalMode.goalMode.startGoal({
      ...input,
      userId: getRequiredUserId(ctx),
    })
  ),
  get: protectedProcedure
    .input(GoalIdInputSchema)
    .query(({ input, ctx }) =>
      ctx.useCases.goalMode.goalMode.getGoal(
        input.goalId,
        getRequiredUserId(ctx)
      )
    ),
  startAttempt: protectedProcedure
    .input(StartAttemptSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalMode.goalMode.startPhaseAttempt({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),
  recordResult: protectedProcedure
    .input(RecordResultSchema)
    .mutation(({ input, ctx }) =>
      ctx.useCases.goalMode.goalMode.handleLoopResult({
        ...input,
        userId: getRequiredUserId(ctx),
      })
    ),
});
