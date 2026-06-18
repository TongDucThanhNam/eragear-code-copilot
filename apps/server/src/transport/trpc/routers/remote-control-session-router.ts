import {
  StartRemoteSessionInputSchema,
  StopRemoteSessionInputSchema,
} from "@/modules/remote-control";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const remoteControlSessionRouter = router({
  startSession: protectedProcedure
    .input(StartRemoteSessionInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.remoteControl.remoteControl.startSession(
        getRequiredUserId(ctx),
        input
      );
    }),

  stopSession: protectedProcedure
    .input(StopRemoteSessionInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.remoteControl.remoteControl.stopSession(
        getRequiredUserId(ctx),
        input.sessionId
      );
    }),
});
