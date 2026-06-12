import {
  DeleteRemoteRelayDeviceInputSchema,
  RecordRemoteRelayHeartbeatInputSchema,
  StartRemoteSessionInputSchema,
  StopRemoteSessionInputSchema,
  UpsertRemoteRelayDeviceInputSchema,
} from "@/modules/remote-control";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const remoteControlRouter = router({
  getStatus: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.remoteControl.remoteControl.getStatus(
      getRequiredUserId(ctx)
    );
  }),

  upsertDevice: protectedProcedure
    .input(UpsertRemoteRelayDeviceInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.remoteControl.remoteControl.upsertDevice(
        getRequiredUserId(ctx),
        input
      );
    }),

  deleteDevice: protectedProcedure
    .input(DeleteRemoteRelayDeviceInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.remoteControl.remoteControl.deleteDevice(
        getRequiredUserId(ctx),
        input.id
      );
    }),

  recordHeartbeat: protectedProcedure
    .input(RecordRemoteRelayHeartbeatInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.remoteControl.remoteControl.recordHeartbeat(
        getRequiredUserId(ctx),
        input.deviceId
      );
    }),

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
