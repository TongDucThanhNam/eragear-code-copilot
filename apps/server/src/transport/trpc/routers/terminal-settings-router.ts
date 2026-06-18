import { UpdateTerminalSettingsInputSchema } from "@/modules/terminal";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const terminalSettingsRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.useCases.terminal.terminal.getSettings(
      getRequiredUserId(ctx)
    );
  }),

  updateSettings: protectedProcedure
    .input(UpdateTerminalSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.terminal.terminal.updateSettings(
        getRequiredUserId(ctx),
        input
      );
    }),
});
