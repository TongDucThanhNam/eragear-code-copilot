import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  InstallPluginRegistryPackageRequestSchema,
  RefreshPluginRegistryRequestSchema,
  RestorePluginRegistrySignerRequestSchema,
  RevokePluginRegistrySignerRequestSchema,
  RevokePluginRegistryTrustRequestSchema,
  TrustPluginRegistryRequestSchema,
  UpsertPluginRegistryRequestSchema,
} from "./settings-plugin-router-data";

export const settingsPluginRegistryRouter = router({
  /** Add or update a saved signed plugin registry descriptor. */
  upsertPluginRegistry: protectedProcedure
    .input(UpsertPluginRegistryRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.upsertPluginRegistry(userId, input)
      )
    ),

  /** Trust a saved plugin registry URL fingerprint before refresh/install. */
  trustPluginRegistry: protectedProcedure
    .input(TrustPluginRegistryRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.trustPluginRegistry(userId, input)
      )
    ),

  /** Revoke a saved plugin registry URL trust approval. */
  revokePluginRegistryTrust: protectedProcedure
    .input(RevokePluginRegistryTrustRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.revokePluginRegistryTrust(userId, input)
      )
    ),

  /** Revoke a plugin registry signer/public-key fingerprint. */
  revokePluginRegistrySigner: protectedProcedure
    .input(RevokePluginRegistrySignerRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.revokePluginRegistrySigner(userId, input)
      )
    ),

  /** Restore a previously revoked plugin registry signer/public-key fingerprint. */
  restorePluginRegistrySigner: protectedProcedure
    .input(RestorePluginRegistrySignerRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.restorePluginRegistrySigner(userId, input)
      )
    ),

  /** Refresh a trusted signed plugin registry and store pinned package metadata. */
  refreshPluginRegistry: protectedProcedure
    .input(RefreshPluginRegistryRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.refreshPluginRegistry(userId, input)
      )
    ),

  /** Install a package from a trusted saved signed plugin registry. */
  installPluginRegistryPackage: protectedProcedure
    .input(InstallPluginRegistryPackageRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.installPluginRegistryPackage(userId, input)
      )
    ),
});
