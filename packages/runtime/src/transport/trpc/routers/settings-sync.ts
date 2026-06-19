import {
  SettingsSyncNowInputSchema,
  UpdateSettingsSyncConfigInputSchema,
} from "#runtime/modules/settings-sync";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const settingsSyncRouter = router({
  getStatus: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.settingsSync.settingsSync.getStatus(
      getRequiredUserId(ctx)
    );
  }),

  updateConfig: protectedProcedure
    .input(UpdateSettingsSyncConfigInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.settingsSync.settingsSync.updateConfig(
        getRequiredUserId(ctx),
        input
      );
    }),

  markFirstRunPromptHandled: protectedProcedure.mutation(({ ctx }) => {
    return ctx.useCases.settingsSync.settingsSync.markFirstRunPromptHandled(
      getRequiredUserId(ctx)
    );
  }),

  syncNow: protectedProcedure
    .input(SettingsSyncNowInputSchema)
    .mutation(({ ctx, input }) => {
      return ctx.useCases.settingsSync.settingsSync.syncNow(
        getRequiredUserId(ctx),
        input
      );
    }),
});
