import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const remoteControlStatusRouter = router({
  getStatus: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.remoteControl.remoteControl.getStatus(
      getRequiredUserId(ctx)
    );
  }),
});
