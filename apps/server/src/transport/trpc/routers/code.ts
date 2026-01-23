import { z } from "zod";
import { CodeContextService } from "../../../modules/tooling/application";
import { publicProcedure, router } from "../base";

export const codeRouter = router({
  getProjectContext: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new CodeContextService(
        ctx.container.getGit(),
        ctx.container.getSessionRuntime()
      );
      return service.getProjectContext(input.chatId);
    }),

  getGitDiff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new CodeContextService(
        ctx.container.getGit(),
        ctx.container.getSessionRuntime()
      );
      return service.getGitDiff(input.chatId);
    }),

  getFileContent: publicProcedure
    .input(z.object({ chatId: z.string(), path: z.string() }))
    .query(async ({ input, ctx }) => {
      const service = new CodeContextService(
        ctx.container.getGit(),
        ctx.container.getSessionRuntime()
      );
      return await service.getFileContent(input.chatId, input.path);
    }),
});
