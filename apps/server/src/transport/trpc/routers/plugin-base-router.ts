import {
  InstallPluginPackageInputSchema,
  PluginProjectInputSchema,
  RevalidatePluginPackageInputSchema,
  TogglePluginInputSchema,
  UpsertPluginInputSchema,
} from "@/modules/plugins";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const pluginBaseRouter = router({
  getOverview: protectedProcedure
    .input(PluginProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.getOverview(getRequiredUserId(ctx), input);
    }),

  getSdkManifest: protectedProcedure.query(({ ctx }) => {
    const service = ctx.useCases.plugins.plugins;
    return service.getSdkManifest();
  }),

  upsert: protectedProcedure
    .input(UpsertPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.upsert(getRequiredUserId(ctx), input);
    }),

  installPackage: protectedProcedure
    .input(InstallPluginPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.installPackage(getRequiredUserId(ctx), input);
    }),

  revalidatePackage: protectedProcedure
    .input(RevalidatePluginPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.revalidatePackage(getRequiredUserId(ctx), input);
    }),

  toggle: protectedProcedure
    .input(TogglePluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.toggle(getRequiredUserId(ctx), input);
    }),
});
