import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  InstallPluginPackageRequestSchema,
  RevalidatePluginPackageRequestSchema,
  TogglePluginRequestSchema,
  UpsertPluginRequestSchema,
} from "./settings-plugin-router-data";

export const settingsPluginBaseRouter = router({
  /** Add or update a project-local plugin descriptor. */
  upsertPlugin: protectedProcedure
    .input(UpsertPluginRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertPlugin(userId, input)
      )
    ),

  /** Install a signed project-local plugin package after signature verification. */
  installPluginPackage: protectedProcedure
    .input(InstallPluginPackageRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.installPluginPackage(userId, input)
      )
    ),

  /** Revalidate an installed signed plugin package against its manifest or registry pins. */
  revalidatePluginPackage: protectedProcedure
    .input(RevalidatePluginPackageRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.revalidatePluginPackage(userId, input)
      )
    ),

  /** Toggle a project-local plugin descriptor. */
  togglePlugin: protectedProcedure
    .input(TogglePluginRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.togglePlugin(userId, input)
      )
    ),
});
