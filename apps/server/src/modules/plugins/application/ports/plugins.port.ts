import type {
  ApprovePluginRunInput,
  DeletePluginBatchPresetInput,
  DeletePluginBatchScheduleInput,
  ExportPluginRunsInput,
  InstallPluginPackageInput,
  InstallPluginRegistryPackageInput,
  PluginProjectInput,
  PluginRunExport,
  PluginsData,
  RefreshPluginRegistryInput,
  RestorePluginRegistrySignerInput,
  RevalidatePluginPackageInput,
  ReviewPluginRunInput,
  RevokePluginRegistrySignerInput,
  RevokePluginRegistryTrustInput,
  RunDuePluginBatchSchedulesInput,
  RunPluginBatchInput,
  RunPluginBatchPresetInput,
  RunPluginInput,
  TogglePluginInput,
  TrustPluginInput,
  TrustPluginRegistryInput,
  UpdatePluginPermissionGrantInput,
  UpdatePluginSchedulingPolicyInput,
  UpsertPluginBatchPresetInput,
  UpsertPluginBatchScheduleInput,
  UpsertPluginInput,
  UpsertPluginRegistryInput,
} from "../contracts/plugins.contract";

export interface PluginsPort {
  listPlugins(userId: string, input?: PluginProjectInput): Promise<PluginsData>;
  upsertPlugin(userId: string, input: UpsertPluginInput): Promise<PluginsData>;
  installPackage(
    userId: string,
    input: InstallPluginPackageInput
  ): Promise<PluginsData>;
  revalidatePackage(
    userId: string,
    input: RevalidatePluginPackageInput
  ): Promise<PluginsData>;
  upsertRegistry(
    userId: string,
    input: UpsertPluginRegistryInput
  ): Promise<PluginsData>;
  trustRegistry(
    userId: string,
    input: TrustPluginRegistryInput
  ): Promise<PluginsData>;
  revokeRegistryTrust(
    userId: string,
    input: RevokePluginRegistryTrustInput
  ): Promise<PluginsData>;
  revokeRegistrySigner(
    userId: string,
    input: RevokePluginRegistrySignerInput
  ): Promise<PluginsData>;
  restoreRegistrySigner(
    userId: string,
    input: RestorePluginRegistrySignerInput
  ): Promise<PluginsData>;
  refreshRegistry(
    userId: string,
    input: RefreshPluginRegistryInput
  ): Promise<PluginsData>;
  installRegistryPackage(
    userId: string,
    input: InstallPluginRegistryPackageInput
  ): Promise<PluginsData>;
  togglePlugin(userId: string, input: TogglePluginInput): Promise<PluginsData>;
  updateSchedulingPolicy(
    userId: string,
    input: UpdatePluginSchedulingPolicyInput
  ): Promise<PluginsData>;
  trustPlugin(userId: string, input: TrustPluginInput): Promise<PluginsData>;
  updatePermissionGrant(
    userId: string,
    input: UpdatePluginPermissionGrantInput
  ): Promise<PluginsData>;
  approveRun(
    userId: string,
    input: ApprovePluginRunInput
  ): Promise<PluginsData>;
  runPlugin(userId: string, input: RunPluginInput): Promise<PluginsData>;
  runBatch(userId: string, input: RunPluginBatchInput): Promise<PluginsData>;
  upsertBatchPreset(
    userId: string,
    input: UpsertPluginBatchPresetInput
  ): Promise<PluginsData>;
  deleteBatchPreset(
    userId: string,
    input: DeletePluginBatchPresetInput
  ): Promise<PluginsData>;
  runBatchPreset(
    userId: string,
    input: RunPluginBatchPresetInput
  ): Promise<PluginsData>;
  upsertBatchSchedule(
    userId: string,
    input: UpsertPluginBatchScheduleInput
  ): Promise<PluginsData>;
  deleteBatchSchedule(
    userId: string,
    input: DeletePluginBatchScheduleInput
  ): Promise<PluginsData>;
  runDueBatchSchedules(
    userId: string,
    input?: RunDuePluginBatchSchedulesInput
  ): Promise<PluginsData>;
  reviewRun(userId: string, input: ReviewPluginRunInput): Promise<PluginsData>;
  exportRuns(
    userId: string,
    input?: ExportPluginRunsInput
  ): Promise<PluginRunExport>;
}
