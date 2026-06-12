import {
  CaptureCrashReportInputSchema,
  UpdateCrashReportingConfigInputSchema,
} from "@/modules/crash-reporting";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const crashReportingRouter = router({
  getStatus: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.crashReporting.crashReporting.getStatus(
      getRequiredUserId(ctx)
    );
  }),

  updateConfig: protectedProcedure
    .input(UpdateCrashReportingConfigInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.crashReporting.crashReporting.updateConfig(input);
    }),

  capture: protectedProcedure
    .input(CaptureCrashReportInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.crashReporting.crashReporting.capture(
        getRequiredUserId(ctx),
        input
      );
    }),
});
