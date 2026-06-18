import { SetSupervisorModeInputSchema } from "@/modules/ai";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const aiSupervisorRouter = router({
  /** Enable or disable server-side supervisor autopilot for a session. */
  setSupervisorMode: protectedProcedure
    .input(SetSupervisorModeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.supervisor.setMode;
      return await service.execute({
        userId: getRequiredUserId(ctx),
        chatId: input.chatId,
        mode: input.mode,
      });
    }),
});
