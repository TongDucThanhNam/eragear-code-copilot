import { SetSupervisorModeInputSchema } from "#runtime/modules/ai";
import { SupervisorChatInputSchema } from "#runtime/modules/supervisor";
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

  /** Ask Supervisos in the dedicated side-chat surface. */
  supervisorChat: protectedProcedure
    .input(SupervisorChatInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.supervisor.chat;
      return await service.execute({
        ...input,
        userId: getRequiredUserId(ctx),
      });
    }),
});
