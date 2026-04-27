import { z } from "zod";

export const SupervisorTurnDecisionSchema = z
  .object({
    action: z.enum(["done", "continue", "needs_user", "abort"]),
    reason: z.string().min(1).max(2000),
    followUpPrompt: z.string().min(1).max(12_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "continue" && !value.followUpPrompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followUpPrompt"],
        message: "continue decisions require followUpPrompt",
      });
    }
    if (value.action !== "continue" && value.followUpPrompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followUpPrompt"],
        message: "followUpPrompt is only valid for continue decisions",
      });
    }
  });

export const SupervisorPermissionDecisionSchema = z.object({
  action: z.enum(["approve", "reject", "defer"]),
  reason: z.string().min(1).max(2000),
});

export type SupervisorTurnDecision = z.infer<
  typeof SupervisorTurnDecisionSchema
>;

export type SupervisorPermissionDecision = z.infer<
  typeof SupervisorPermissionDecisionSchema
>;
