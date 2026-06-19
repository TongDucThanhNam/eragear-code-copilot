import { z } from "zod";

export const ContextUsageEstimateInputSchema = z
  .object({
    chatId: z.string().trim().min(1),
    draftText: z.string().max(200_000).optional().default(""),
    modelId: z.string().trim().min(1).optional(),
    attachmentCount: z.number().int().min(0).max(100).optional().default(0),
    attachmentBytes: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .optional()
      .default(0),
    mentionCount: z.number().int().min(0).max(500).optional().default(0),
  })
  .strict();

export const ContextUsageStatusSchema = z.enum([
  "ok",
  "warn",
  "compact",
  "overflow",
]);

export const ContextUsageSourceSchema = z.enum(["tokenlens", "fallback"]);

export const ContextUsageTokenSourceSchema = z.enum(["local-estimate"]);

export const ContextUsageBreakdownSchema = z
  .object({
    historyTokens: z.number().int().nonnegative(),
    draftTokens: z.number().int().nonnegative(),
    attachmentTokens: z.number().int().nonnegative(),
    mentionTokens: z.number().int().nonnegative(),
  })
  .strict();

export const ContextUsageEstimateSchema = z
  .object({
    chatId: z.string().trim().min(1),
    modelId: z.string().trim().min(1).optional(),
    modelProvider: z.string().trim().min(1).optional(),
    usedTokens: z.number().int().nonnegative(),
    maxTokens: z.number().int().positive(),
    remainingTokens: z.number().int(),
    percentUsed: z.number().min(0),
    status: ContextUsageStatusSchema,
    messageCount: z.number().int().nonnegative(),
    truncatedHistory: z.boolean(),
    estimatedAt: z.number().int().nonnegative(),
    source: ContextUsageSourceSchema,
    tokenSource: ContextUsageTokenSourceSchema,
    breakdown: ContextUsageBreakdownSchema,
  })
  .strict();

export type ContextUsageEstimateInput = z.infer<
  typeof ContextUsageEstimateInputSchema
>;
export type ContextUsageStatus = z.infer<typeof ContextUsageStatusSchema>;
export type ContextUsageSource = z.infer<typeof ContextUsageSourceSchema>;
export type ContextUsageTokenSource = z.infer<
  typeof ContextUsageTokenSourceSchema
>;
export type ContextUsageBreakdown = z.infer<typeof ContextUsageBreakdownSchema>;
export type ContextUsageEstimate = z.infer<typeof ContextUsageEstimateSchema>;
