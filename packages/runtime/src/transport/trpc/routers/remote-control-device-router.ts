import {
  DeleteRemoteRelayDeviceInputSchema,
  RecordRemoteRelayHeartbeatInputSchema,
  UpsertRemoteRelayDeviceInputSchema,
} from "#runtime/modules/remote-control";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const remoteControlDeviceRouter = router({
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
});
