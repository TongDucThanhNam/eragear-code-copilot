import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const projectQueryRouter = router({
  listProjects: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.project.list;
    return await service.execute(getRequiredUserId(ctx));
  }),
});
