/**
 * Code tRPC Router
 *
 * RPC endpoints for code context operations: retrieving project context,
 * git diff, and file content. Provides read-only access to codebase information.
 *
 * @module transport/trpc/routers/code
 */

import {
  CodeChatIdInputSchema,
  CodeFileContentInputSchema,
  SyncEditorBufferInputSchema,
} from "@/modules/tooling";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const codeRouter = router({
  /** Get project context (rules, tabs, files) */
  getProjectContext: protectedProcedure
    .input(CodeChatIdInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return service.getProjectContext(getRequiredUserId(ctx), input.chatId);
    }),

  /** Get git diff for the project's working directory */
  getGitDiff: protectedProcedure
    .input(CodeChatIdInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return service.getGitDiff(getRequiredUserId(ctx), input.chatId);
    }),

  /** Get file content from the project */
  getFileContent: protectedProcedure
    .input(CodeFileContentInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return await service.getFileContent(
        getRequiredUserId(ctx),
        input.chatId,
        input.path
      );
    }),

  /** Sync unsaved editor buffer content for ACP fs/read_text_file overrides */
  syncEditorBuffer: protectedProcedure
    .input(SyncEditorBufferInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return await service.syncEditorBuffer({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        path: input.path,
        isDirty: input.isDirty,
        content: input.content,
      });
    }),
});
