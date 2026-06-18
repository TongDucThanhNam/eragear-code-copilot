import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";
import {
  createFileWatcherStatusInput,
  FileWatcherStatusRequestSchema,
} from "./file-watcher-router-data";

export const fileWatcherRouter = router({
  status: protectedProcedure
    .input(FileWatcherStatusRequestSchema)
    .query(({ input, ctx }) => {
      const service = ctx.useCases.fileWatcher.fileWatcher;
      return service.getStatus(
        createFileWatcherStatusInput(input, getRequiredUserId(ctx))
      );
    }),
});
