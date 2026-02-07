import { z } from "zod";

export const RespondPermissionInputSchema = z.object({
  chatId: z.string(),
  requestId: z.string(),
  decision: z.string(),
});

export const CodeChatIdInputSchema = z.object({
  chatId: z.string(),
});

export const CodeFileContentInputSchema = z.object({
  chatId: z.string(),
  path: z.string(),
});

export type RespondPermissionInput = z.infer<
  typeof RespondPermissionInputSchema
>;
export type CodeChatIdInput = z.infer<typeof CodeChatIdInputSchema>;
export type CodeFileContentInput = z.infer<typeof CodeFileContentInputSchema>;
