import {
  DeleteSlashCommandInputSchema,
  SlashCommandsProjectInputSchema,
  ToggleSlashCommandInputSchema,
  UpsertSlashCommandInputSchema,
} from "@/modules/commands";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const commandsRouter = router({
  list: protectedProcedure
    .input(SlashCommandsProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.list(getRequiredUserId(ctx), input);
    }),

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

  setEnabled: protectedProcedure
    .input(ToggleSlashCommandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.setEnabled(getRequiredUserId(ctx), input);
    }),

  delete: protectedProcedure
    .input(DeleteSlashCommandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.commands.commands;
      return await service.delete(getRequiredUserId(ctx), input);
    }),
});
