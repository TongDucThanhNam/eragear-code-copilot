import { ToggleSlashCommandInputSchema } from "#runtime/modules/commands";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const commandsStateRouter = router({
  setEnabled: protectedProcedure
    .input(ToggleSlashCommandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.setEnabled(getRequiredUserId(ctx), input);
    }),
});
