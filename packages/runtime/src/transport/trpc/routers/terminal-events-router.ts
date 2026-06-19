import { TerminalEventsInputSchema } from "#runtime/modules/terminal";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";
import { createTerminalEventsObservable } from "./terminal-events-observable";

export const terminalEventsRouter = router({
  onTerminalEvents: protectedProcedure
    .input(TerminalEventsInputSchema)
    .subscription(({ ctx, input }) => {
      return createTerminalEventsObservable({
        service: ctx.useCases.terminal.terminal,
        userId: getRequiredUserId(ctx),
        terminalId: input.terminalId,
      });
    }),
});
