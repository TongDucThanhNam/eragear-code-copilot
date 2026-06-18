import {
  InstallPluginRegistryPackageInputSchema,
  RefreshPluginRegistryInputSchema,
  RestorePluginRegistrySignerInputSchema,
  RevokePluginRegistrySignerInputSchema,
  RevokePluginRegistryTrustInputSchema,
  TrustPluginRegistryInputSchema,
  UpsertPluginRegistryInputSchema,
} from "@/modules/plugins";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const pluginRegistryRouter = router({
  upsertRegistry: protectedProcedure
    .input(UpsertPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.upsertRegistry(getRequiredUserId(ctx), input);
    }),

  trustRegistry: protectedProcedure
    .input(TrustPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.trustRegistry(getRequiredUserId(ctx), input);
    }),

  revokeRegistryTrust: protectedProcedure
    .input(RevokePluginRegistryTrustInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.revokeRegistryTrust(getRequiredUserId(ctx), input);
    }),

  revokeRegistrySigner: protectedProcedure
    .input(RevokePluginRegistrySignerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.revokeRegistrySigner(getRequiredUserId(ctx), input);
    }),

  restoreRegistrySigner: protectedProcedure
    .input(RestorePluginRegistrySignerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.restoreRegistrySigner(getRequiredUserId(ctx), input);
    }),

  refreshRegistry: protectedProcedure
    .input(RefreshPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.refreshRegistry(getRequiredUserId(ctx), input);
    }),

  installRegistryPackage: protectedProcedure
    .input(InstallPluginRegistryPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.installRegistryPackage(
        getRequiredUserId(ctx),
        input
      );
    }),
});
