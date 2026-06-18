import {
  CodeChatIdInputSchema,
  CodeFileContentInputSchema,
} from "@/modules/tooling";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const codeContextRouter = router({
  /** Get project context (rules, tabs, files) */
  getProjectContext: protectedProcedure
    .input(CodeChatIdInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.useCases.tooling.codeContext;
      return service.getProjectContext(getRequiredUserId(ctx), input.chatId);
    }),

  /** Get git diff for the project's working directory */
  getGitDiff: protectedProcedure
    .input(CodeChatIdInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.useCases.tooling.codeContext;
      return service.getGitDiff(getRequiredUserId(ctx), input.chatId);
    }),

  /** Get file content from the project */
  getFileContent: protectedProcedure
    .input(CodeFileContentInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.tooling.codeContext;
      return await service.getFileContent(
        getRequiredUserId(ctx),
        input.chatId,
        input.path
      );
    }),
});
