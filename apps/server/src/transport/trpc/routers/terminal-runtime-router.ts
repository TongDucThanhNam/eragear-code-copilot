import {
  CreateTerminalInputSchema,
  KillTerminalInputSchema,
  ResizeTerminalInputSchema,
  WriteTerminalInputSchema,
} from "@/modules/terminal";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const terminalRuntimeRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.useCases.terminal.terminal.list(getRequiredUserId(ctx));
  }),

  create: protectedProcedure
    .input(CreateTerminalInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.terminal.terminal.create(
        getRequiredUserId(ctx),
        input
      );
    }),

  write: protectedProcedure
    .input(WriteTerminalInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.terminal.terminal.write(
        getRequiredUserId(ctx),
        input
      );
    }),

  resize: protectedProcedure
    .input(ResizeTerminalInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.terminal.terminal.resize(
        getRequiredUserId(ctx),
        input
      );
    }),

  kill: protectedProcedure
    .input(KillTerminalInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.terminal.terminal.kill(
        getRequiredUserId(ctx),
        input
      );
    }),
});
