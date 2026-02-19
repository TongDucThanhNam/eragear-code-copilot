import { z } from "zod";
import {
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
} from "@/config/constants";

export const SessionChatIdInputSchema = z.object({
  chatId: z.string(),
});

export const CreateSessionInputSchema = z.object({
  projectId: z.string().min(1),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const ListSessionsInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(HARD_MAX_SESSION_LIST_PAGE_LIMIT)
      .optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional();

export const SessionListPageInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(HARD_MAX_SESSION_LIST_PAGE_LIMIT)
      .optional(),
    cursor: z.string().min(1).optional(),
  })
  .optional();

export const UpdateSessionMetaInputSchema = z.object({
  chatId: z.string(),
  name: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const SessionMessagesPageInputSchema = z.object({
  chatId: z.string(),
  cursor: z.number().int().min(0).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT)
    .optional(),
  includeCompacted: z.boolean().optional(),
});

export const SessionMessageByIdInputSchema = z.object({
  chatId: z.string(),
  messageId: z.string().min(1),
});

export type SessionChatIdInput = z.infer<typeof SessionChatIdInputSchema>;
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;
export type ListSessionsInput = z.infer<typeof ListSessionsInputSchema>;
export type SessionListPageInput = z.infer<typeof SessionListPageInputSchema>;
export type UpdateSessionMetaInput = z.infer<
  typeof UpdateSessionMetaInputSchema
>;
export type SessionMessagesPageInput = z.infer<
  typeof SessionMessagesPageInputSchema
>;
export type SessionMessageByIdInput = z.infer<
  typeof SessionMessageByIdInputSchema
>;
