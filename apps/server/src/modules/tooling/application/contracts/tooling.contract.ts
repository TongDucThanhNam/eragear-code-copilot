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

export const SyncEditorBufferInputSchema = z
  .object({
    chatId: z.string(),
    path: z.string().min(1),
    isDirty: z.boolean(),
    content: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.isDirty && value.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "content is required when isDirty is true",
      });
    }
  });

export type RespondPermissionInput = z.infer<
  typeof RespondPermissionInputSchema
>;
export type CodeChatIdInput = z.infer<typeof CodeChatIdInputSchema>;
export type CodeFileContentInput = z.infer<typeof CodeFileContentInputSchema>;
export type SyncEditorBufferInput = z.infer<typeof SyncEditorBufferInputSchema>;
