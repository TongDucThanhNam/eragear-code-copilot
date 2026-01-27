/**
 * Code tRPC Router
 *
 * RPC endpoints for code context operations: retrieving project context,
 * git diff, and file content. Provides read-only access to codebase information.
 *
 * @module transport/trpc/routers/code
 */

import { z } from "zod";
import { CodeContextService } from "@/modules/tooling/application/code-context.service";
import { protectedProcedure, router } from "../base";

export const codeRouter = router({
  /** Get project context (rules, tabs, files) */
  getProjectContext: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new CodeContextService(
        ctx.container.getGit(),
        ctx.container.getSessionRuntime()
      );
      return service.getProjectContext(input.chatId);
    }),

  /** Get git diff for the project's working directory */
  getGitDiff: protectedProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input, ctx }) => {
      const service = new CodeContextService(
        ctx.container.getGit(),
        ctx.container.getSessionRuntime()
      );
      return service.getGitDiff(input.chatId);
    }),

  /** Get file content from the project */
  getFileContent: protectedProcedure
    .input(z.object({ chatId: z.string(), path: z.string() }))
    .query(async ({ input, ctx }) => {
      const service = new CodeContextService(
        ctx.container.getGit(),
        ctx.container.getSessionRuntime()
      );
      return await service.getFileContent(input.chatId, input.path);
    }),
});
