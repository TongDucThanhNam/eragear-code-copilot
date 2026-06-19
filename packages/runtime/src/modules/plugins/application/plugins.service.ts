import {
  type ApprovePluginRunInput,
  type DeletePluginBatchPresetInput,
  type DeletePluginBatchScheduleInput,
  type ExportPluginRunsInput,
  type InstallPluginPackageInput,
  type InstallPluginRegistryPackageInput,
  PLUGIN_SDK_MANIFEST_VERSION,
  type PluginDescriptor,
  type PluginProjectInput,
  type PluginRunExport,
  type PluginSdkManifest,
  type PluginsData,
  type PluginsOverview,
  type RefreshPluginRegistryInput,
  type RestorePluginRegistrySignerInput,
  type RevalidatePluginPackageInput,
  type ReviewPluginRunInput,
  type RevokePluginRegistrySignerInput,
  type RevokePluginRegistryTrustInput,
  type RunDuePluginBatchSchedulesInput,
  type RunPluginBatchInput,
  type RunPluginBatchPresetInput,
  type RunPluginInput,
  type TogglePluginInput,
  type TrustPluginInput,
  type TrustPluginRegistryInput,
  type UpdatePluginPermissionGrantInput,
  type UpdatePluginSchedulingPolicyInput,
  type UpsertPluginBatchPresetInput,
  type UpsertPluginBatchScheduleInput,
  type UpsertPluginInput,
  type UpsertPluginRegistryInput,
} from "./contracts/plugins.contract";
import type { PluginsPort } from "./ports/plugins.port";

export class PluginsService {
  private readonly plugins: PluginsPort;

  constructor(plugins: PluginsPort) {
    this.plugins = plugins;
  }

  async getOverview(
    userId: string,
    input?: PluginProjectInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.listPlugins(userId, input));
  }

  getSdkManifest(): PluginSdkManifest {
    return createPluginSdkManifest();
  }

  async upsert(
    userId: string,
    input: UpsertPluginInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.upsertPlugin(userId, input));
  }

  async installPackage(
    userId: string,
    input: InstallPluginPackageInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.installPackage(userId, input));
  }

  async revalidatePackage(
    userId: string,
    input: RevalidatePluginPackageInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.revalidatePackage(userId, input));
  }

  async upsertRegistry(
    userId: string,
    input: UpsertPluginRegistryInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.upsertRegistry(userId, input));
  }

  async trustRegistry(
    userId: string,
    input: TrustPluginRegistryInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.trustRegistry(userId, input));
  }

  async revokeRegistryTrust(
    userId: string,
    input: RevokePluginRegistryTrustInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.revokeRegistryTrust(userId, input));
  }

  async revokeRegistrySigner(
    userId: string,
    input: RevokePluginRegistrySignerInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.revokeRegistrySigner(userId, input));
  }

  async restoreRegistrySigner(
    userId: string,
    input: RestorePluginRegistrySignerInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.restoreRegistrySigner(userId, input));
  }

  async refreshRegistry(
    userId: string,
    input: RefreshPluginRegistryInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.refreshRegistry(userId, input));
  }

  async installRegistryPackage(
    userId: string,
    input: InstallPluginRegistryPackageInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.installRegistryPackage(userId, input));
  }

  async toggle(
    userId: string,
    input: TogglePluginInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.togglePlugin(userId, input));
  }

  async updateSchedulingPolicy(
    userId: string,
    input: UpdatePluginSchedulingPolicyInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.updateSchedulingPolicy(userId, input));
  }

  async trust(
    userId: string,
    input: TrustPluginInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.trustPlugin(userId, input));
  }

  async updatePermissionGrant(
    userId: string,
    input: UpdatePluginPermissionGrantInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.updatePermissionGrant(userId, input));
  }

  async approveRun(
    userId: string,
    input: ApprovePluginRunInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.approveRun(userId, input));
  }

  async run(userId: string, input: RunPluginInput): Promise<PluginsOverview> {
    return toOverview(await this.plugins.runPlugin(userId, input));
  }

  async runBatch(
    userId: string,
    input: RunPluginBatchInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.runBatch(userId, input));
  }

  async upsertBatchPreset(
    userId: string,
    input: UpsertPluginBatchPresetInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.upsertBatchPreset(userId, input));
  }

  async deleteBatchPreset(
    userId: string,
    input: DeletePluginBatchPresetInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.deleteBatchPreset(userId, input));
  }

  async runBatchPreset(
    userId: string,
    input: RunPluginBatchPresetInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.runBatchPreset(userId, input));
  }

  async upsertBatchSchedule(
    userId: string,
    input: UpsertPluginBatchScheduleInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.upsertBatchSchedule(userId, input));
  }

  async deleteBatchSchedule(
    userId: string,
    input: DeletePluginBatchScheduleInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.deleteBatchSchedule(userId, input));
  }

  async runDueBatchSchedules(
    userId: string,
    input?: RunDuePluginBatchSchedulesInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.runDueBatchSchedules(userId, input));
  }

  async reviewRun(
    userId: string,
    input: ReviewPluginRunInput
  ): Promise<PluginsOverview> {
    return toOverview(await this.plugins.reviewRun(userId, input));
  }

  async exportRuns(
    userId: string,
    input?: ExportPluginRunsInput
  ): Promise<PluginRunExport> {
    return await this.plugins.exportRuns(userId, input);
  }
}

export function createPluginSdkManifest(): PluginSdkManifest {
  return {
    manifestVersion: PLUGIN_SDK_MANIFEST_VERSION,
    manifestFileNames: ["eragear-plugin.json", "plugin.json"],
    scopes: ["process", "project-root", "env"],
    lifecycleOperations: [
      "manual-run",
      "batch-run",
      "scheduled-batch",
      "audit-review",
      "package-revalidate",
    ],
    marketplaceHooks: [
      "registry-upsert",
      "registry-trust",
      "registry-refresh",
      "registry-install",
      "signer-revocation",
    ],
    packageSecurity: [
      "signed-manifest",
      "command-fingerprint",
      "permission-fingerprint",
      "registry-fingerprint",
      "public-key-revocation",
    ],
    manifestExample: {
      manifestVersion: PLUGIN_SDK_MANIFEST_VERSION,
      id: "example.plugin",
      name: "Example Plugin",
      command: "node",
      args: ["scripts/example-plugin.mjs"],
      scopes: ["process"],
      workspaceAccess: "sandbox",
    },
  };
}

function toOverview(data: PluginsData): PluginsOverview {
  return {
    ...data,
    sdk: createPluginSdkManifest(),
    lifecycle: createLifecycleSummary(data),
    marketplace: createMarketplaceSummary(data),
  };
}

function createLifecycleSummary(
  data: PluginsData
): PluginsOverview["lifecycle"] {
  const plugins = data.plugins;

  return {
    total: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    disabled: plugins.filter((plugin) => !plugin.enabled).length,
    trusted: plugins.filter((plugin) => plugin.trustStatus === "trusted")
      .length,
    needsTrust: plugins.filter((plugin) => plugin.trustStatus !== "trusted")
      .length,
    permissionGranted: plugins.filter(
      (plugin) => plugin.permissionStatus === "granted"
    ).length,
    needsPermission: plugins.filter(
      (plugin) => plugin.permissionStatus !== "granted"
    ).length,
    policyBlocked: plugins.filter(
      (plugin) => plugin.executionPolicy.status === "blocked"
    ).length,
    schedulingBlocked: plugins.filter(
      (plugin) => plugin.scheduling.status !== "ready"
    ).length,
    packageBlocked: plugins.filter(hasPackageBlocker).length,
    ready: plugins.filter(isReadyPlugin).length,
    scheduledBatches: data.batchSchedules.filter((schedule) => schedule.enabled)
      .length,
    dueSchedules: data.batchSchedules.filter(
      (schedule) => schedule.status === "due"
    ).length,
  };
}

function createMarketplaceSummary(
  data: PluginsData
): PluginsOverview["marketplace"] {
  const registryPackages = data.registries.flatMap(
    (registry) => registry.packages
  );

  return {
    localCatalogPackages: data.catalog.length,
    installableCatalogPackages: data.catalog.filter(
      (item) => item.status === "installable"
    ).length,
    registries: data.registries.length,
    trustedRegistries: data.registries.filter(
      (registry) => registry.trustStatus === "trusted"
    ).length,
    registryPackages: registryPackages.length,
    installableRegistryPackages: registryPackages.filter(
      (item) => item.status === "installable"
    ).length,
    installedRegistryPackages: registryPackages.filter(
      (item) => item.status === "installed"
    ).length,
    updateAvailablePackages: registryPackages.filter(
      (item) => item.status === "update-available"
    ).length,
    revokedRegistryPackages: registryPackages.filter(
      (item) => item.status === "revoked"
    ).length,
  };
}

function isReadyPlugin(plugin: PluginDescriptor): boolean {
  return (
    plugin.enabled &&
    plugin.trustStatus === "trusted" &&
    plugin.permissionStatus === "granted" &&
    plugin.executionPolicy.status === "allowed" &&
    plugin.scheduling.status === "ready" &&
    !hasPackageBlocker(plugin)
  );
}

function hasPackageBlocker(plugin: PluginDescriptor): boolean {
  return (
    plugin.packageExpiryStatus === "expired" ||
    plugin.packageGovernanceStatus === "verification-failed"
  );
}
