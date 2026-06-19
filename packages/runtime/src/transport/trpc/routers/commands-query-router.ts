import { SlashCommandsProjectInputSchema } from "#runtime/modules/commands";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const commandsQueryRouter = router({
  list: protectedProcedure
    .input(SlashCommandsProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.list(getRequiredUserId(ctx), input);
    }),
});
