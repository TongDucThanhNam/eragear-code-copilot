import { SyncEditorBufferInputSchema } from "@/modules/tooling";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const codeEditorBufferRouter = router({
  /** Sync unsaved editor buffer content for ACP fs/read_text_file overrides */
  syncEditorBuffer: protectedProcedure
    .input(SyncEditorBufferInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.tooling.codeContext;
      return await service.syncEditorBuffer({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        path: input.path,
        isDirty: input.isDirty,
        content: input.content,
      });
    }),
});
