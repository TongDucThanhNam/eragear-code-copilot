import { observable } from "@trpc/server/observable";
import {
  CreateTerminalInputSchema,
  KillTerminalInputSchema,
  type TerminalEvent,
  TerminalEventsInputSchema,
  UpdateTerminalSettingsInputSchema,
  WriteTerminalInputSchema,
} from "@/modules/terminal";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const terminalRouter = router({
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

  kill: protectedProcedure
    .input(KillTerminalInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.terminal.terminal.kill(
        getRequiredUserId(ctx),
        input
      );
    }),

  onTerminalEvents: protectedProcedure
    .input(TerminalEventsInputSchema)
    .subscription(({ ctx, input }) => {
      return observable<TerminalEvent>((emit) => {
        const unsubscribe = ctx.useCases.terminal.terminal.subscribe(
          getRequiredUserId(ctx),
          input.terminalId,
          (event) => emit.next(event)
        );
        return () => unsubscribe();
      });
    }),
});
