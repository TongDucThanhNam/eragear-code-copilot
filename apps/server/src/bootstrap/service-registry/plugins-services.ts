import {
  type ApprovePluginRunInput,
  type DeletePluginBatchPresetInput,
  type DeletePluginBatchScheduleInput,
  type ExportPluginRunsInput,
  type InstallPluginPackageInput,
  type InstallPluginRegistryPackageInput,
  type PluginProjectInput,
  type PluginRunExport,
  type PluginsData,
  type PluginsPort,
  PluginsService,
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
} from "@/modules/plugins";
import type { LocalAdeService } from "@/modules/settings";
import type { PluginsUseCases, UseCasePort } from "@/modules/use-cases";

type LocalAdeSnapshot = Awaited<ReturnType<LocalAdeService["snapshot"]>>;

class LocalAdePluginsAdapter implements PluginsPort {
  private readonly localAde: UseCasePort<LocalAdeService>;

  constructor(localAde: UseCasePort<LocalAdeService>) {
    this.localAde = localAde;
  }

  async listPlugins(
    userId: string,
    _input?: PluginProjectInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.snapshot(userId));
  }

  async upsertPlugin(
    userId: string,
    input: UpsertPluginInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.upsertPlugin(userId, input));
  }

  async installPackage(
    userId: string,
    input: InstallPluginPackageInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.installPluginPackage(userId, input)
    );
  }

  async revalidatePackage(
    userId: string,
    input: RevalidatePluginPackageInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.revalidatePluginPackage(userId, input)
    );
  }

  async upsertRegistry(
    userId: string,
    input: UpsertPluginRegistryInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.upsertPluginRegistry(userId, input)
    );
  }

  async trustRegistry(
    userId: string,
    input: TrustPluginRegistryInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.trustPluginRegistry(userId, input)
    );
  }

  async revokeRegistryTrust(
    userId: string,
    input: RevokePluginRegistryTrustInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.revokePluginRegistryTrust(userId, input)
    );
  }

  async revokeRegistrySigner(
    userId: string,
    input: RevokePluginRegistrySignerInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.revokePluginRegistrySigner(userId, input)
    );
  }

  async restoreRegistrySigner(
    userId: string,
    input: RestorePluginRegistrySignerInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.restorePluginRegistrySigner(userId, input)
    );
  }

  async refreshRegistry(
    userId: string,
    input: RefreshPluginRegistryInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.refreshPluginRegistry(userId, input)
    );
  }

  async installRegistryPackage(
    userId: string,
    input: InstallPluginRegistryPackageInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.installPluginRegistryPackage(userId, input)
    );
  }

  async togglePlugin(
    userId: string,
    input: TogglePluginInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.togglePlugin(userId, input));
  }

  async updateSchedulingPolicy(
    userId: string,
    input: UpdatePluginSchedulingPolicyInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.updatePluginSchedulingPolicy(userId, input)
    );
  }

  async trustPlugin(
    userId: string,
    input: TrustPluginInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.trustPlugin(userId, input));
  }

  async updatePermissionGrant(
    userId: string,
    input: UpdatePluginPermissionGrantInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.updatePluginPermissionGrant(userId, input)
    );
  }

  async approveRun(
    userId: string,
    input: ApprovePluginRunInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.approvePluginRun(userId, input));
  }

  async runPlugin(userId: string, input: RunPluginInput): Promise<PluginsData> {
    return toPluginsData(await this.localAde.runPlugin(userId, input));
  }

  async runBatch(
    userId: string,
    input: RunPluginBatchInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.runPluginBatch(userId, input));
  }

  async upsertBatchPreset(
    userId: string,
    input: UpsertPluginBatchPresetInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.upsertPluginBatchPreset(userId, input)
    );
  }

  async deleteBatchPreset(
    userId: string,
    input: DeletePluginBatchPresetInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.deletePluginBatchPreset(userId, input)
    );
  }

  async runBatchPreset(
    userId: string,
    input: RunPluginBatchPresetInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.runPluginBatchPreset(userId, input)
    );
  }

  async upsertBatchSchedule(
    userId: string,
    input: UpsertPluginBatchScheduleInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.upsertPluginBatchSchedule(userId, input)
    );
  }

  async deleteBatchSchedule(
    userId: string,
    input: DeletePluginBatchScheduleInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.deletePluginBatchSchedule(userId, input)
    );
  }

  async runDueBatchSchedules(
    userId: string,
    input?: RunDuePluginBatchSchedulesInput
  ): Promise<PluginsData> {
    return toPluginsData(
      await this.localAde.runDuePluginBatchSchedules(userId, input ?? {})
    );
  }

  async reviewRun(
    userId: string,
    input: ReviewPluginRunInput
  ): Promise<PluginsData> {
    return toPluginsData(await this.localAde.reviewPluginRun(userId, input));
  }

  async exportRuns(
    userId: string,
    input?: ExportPluginRunsInput
  ): Promise<PluginRunExport> {
    return await this.localAde.exportPluginRuns(userId, input ?? {});
  }
}

function toPluginsData(snapshot: LocalAdeSnapshot): PluginsData {
  return {
    configPath: snapshot.plugins.configPath,
    schedulingPolicy: snapshot.plugins.schedulingPolicy,
    plugins: snapshot.plugins.items,
    catalog: snapshot.plugins.catalog,
    registries: snapshot.plugins.registries,
    recentRuns: snapshot.plugins.recentRuns,
    recentBatches: snapshot.plugins.recentBatches,
    batchPresets: snapshot.plugins.batchPresets,
    batchSchedules: snapshot.plugins.batchSchedules,
    dependencyGraph: snapshot.plugins.dependencyGraph,
  };
}

export function createPluginsUseCases(
  localAde: UseCasePort<LocalAdeService>
): PluginsUseCases {
  return {
    plugins: new PluginsService(new LocalAdePluginsAdapter(localAde)),
  };
}
