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
} from "@/modules/tooling";
import { protectedProcedure, router } from "../base";

export const codeRouter = router({
  /** Get project context (rules, tabs, files) */
  getProjectContext: protectedProcedure
    .input(CodeChatIdInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return service.getProjectContext(input.chatId);
    }),

  /** Get git diff for the project's working directory */
  getGitDiff: protectedProcedure
    .input(CodeChatIdInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return service.getGitDiff(input.chatId);
    }),

  /** Get file content from the project */
  getFileContent: protectedProcedure
    .input(CodeFileContentInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.toolingServices.codeContext();
      return await service.getFileContent(input.chatId, input.path);
    }),
});
