import {
  DeleteSlashCommandInputSchema,
  UpsertSlashCommandInputSchema,
} from "#runtime/modules/commands";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const commandsMutationRouter = router({
  create: protectedProcedure
    .input(UpsertSlashCommandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.create(getRequiredUserId(ctx), input);
    }),

  update: protectedProcedure
    .input(UpsertSlashCommandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.update(getRequiredUserId(ctx), input);
    }),

  delete: protectedProcedure
    .input(DeleteSlashCommandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.delete(getRequiredUserId(ctx), input);
    }),
});
