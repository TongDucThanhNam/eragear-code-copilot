import { z } from "zod";

const MAX_SUPERVISOS_CHAT_MESSAGE_CHARS = 12_000;
const MAX_SUPERVISOS_HISTORY_MESSAGE_CHARS = 6000;
const MAX_SUPERVISOS_HISTORY_MESSAGES = 16;
const MAX_GOAL_AUDIT_ENTRIES = 6;

export const SupervisorChatHistoryMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(MAX_SUPERVISOS_HISTORY_MESSAGE_CHARS),
  })
  .strict();

export const SupervisorGoalModeAuditSummarySchema = z
  .object({
    phaseId: z.string().trim().min(1).max(160),
    kind: z.string().trim().min(1).max(120),
    decision: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().min(1).max(800).optional(),
    targetPath: z.string().trim().min(1).max(4096).optional(),
    verification: z.string().trim().min(1).max(800).optional(),
    occurredAt: z
      .union([z.string().trim().max(80), z.number().finite()])
      .optional(),
  })
  .strict();

export const SupervisorChatInputSchema = z
  .object({
    chatId: z.string().trim().min(1),
    message: z.string().trim().min(1).max(MAX_SUPERVISOS_CHAT_MESSAGE_CHARS),
    history: z
      .array(SupervisorChatHistoryMessageSchema)
      .max(MAX_SUPERVISOS_HISTORY_MESSAGES)
      .optional(),
    context: z
      .object({
        goalModeAudit: z
          .array(SupervisorGoalModeAuditSummarySchema)
          .max(MAX_GOAL_AUDIT_ENTRIES)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SupervisorChatInput = z.infer<typeof SupervisorChatInputSchema>;
