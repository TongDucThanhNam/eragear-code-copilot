import { protectedProcedure, router } from "../base";
import { UpdateBootAllowlistsRequestSchema } from "./settings-boot-allowlists-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsBaseRouter = router({
  /** Get persisted UI/app settings */
  get: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.settings.get;
    return await service.execute();
  }),

  /** Get boot/runtime allowlists */
  getBootAllowlists: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.settings.manageBootAllowlists;
    return await service.get();
  }),

  /** Update boot/runtime allowlists and hot-apply spawn policy when possible */
  updateBootAllowlists: protectedProcedure
    .input(UpdateBootAllowlistsRequestSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.manageBootAllowlists;
      return await service.update(input);
    }),

  /** Get the local Electron ADE control-center read model. */
  getLocalAdeSnapshot: protectedProcedure.query(
    resolveSettingsLocalAde((service, userId) => service.snapshot(userId))
  ),
});
