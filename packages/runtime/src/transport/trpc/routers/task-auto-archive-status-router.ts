import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const taskAutoArchiveStatusRouter = router({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.taskAutoArchive.taskAutoArchive;
    return await service.getStatus(getRequiredUserId(ctx));
  }),
});
