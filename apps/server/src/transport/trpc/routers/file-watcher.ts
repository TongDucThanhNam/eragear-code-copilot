import { z } from "zod";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const FileWatcherStatusInputSchema = z
  .object({
    currentUserOnly: z.boolean().optional(),
  })
  .strict()
  .optional();

export const fileWatcherRouter = router({
  status: protectedProcedure
    .input(FileWatcherStatusInputSchema)
    .query(({ input, ctx }) => {
      const service = ctx.useCases.fileWatcher.fileWatcher;
      return service.status(
        input?.currentUserOnly === false
          ? undefined
          : { userId: getRequiredUserId(ctx) }
      );
    }),
});
