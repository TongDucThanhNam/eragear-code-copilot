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

// --- Semantic Decision Schema ---

const SEMANTIC_ACTIONS_REQUIRING_FOLLOWUP = [
  "CONTINUE",
  "APPROVE_GATE",
  "CORRECT",
  "REPLAN",
  "SAVE_MEMORY",
] as const;

export const SupervisorSemanticDecisionSchema = z
  .object({
    semanticAction: z.enum([
      "CONTINUE",
      "APPROVE_GATE",
      "CORRECT",
      "REPLAN",
      "DONE",
      "ESCALATE",
      "ABORT",
      "SAVE_MEMORY",
      "WAIT",
    ]),
    reason: z.string().min(1).max(2000),
    followUpPrompt: z.string().min(1).max(12_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      SEMANTIC_ACTIONS_REQUIRING_FOLLOWUP.includes(
        value.semanticAction as (typeof SEMANTIC_ACTIONS_REQUIRING_FOLLOWUP)[number]
      ) &&
      !value.followUpPrompt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["followUpPrompt"],
        message:
          "followUpPrompt is required for CONTINUE, APPROVE_GATE, CORRECT, REPLAN, SAVE_MEMORY",
      });
    }
  });
