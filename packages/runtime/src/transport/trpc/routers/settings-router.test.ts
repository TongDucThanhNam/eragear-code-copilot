import { describe, expect, test } from "bun:test";
import { settingsRouter } from "./settings";

describe("settingsRouter", () => {
  test("keeps extracted base settings procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.get).toBeDefined();
    expect(procedures.updateUi).toBeDefined();
    expect(procedures.updateApp).toBeDefined();
    expect(procedures.getBootAllowlists).toBeDefined();
    expect(procedures.updateBootAllowlists).toBeDefined();
    expect(procedures.getLocalAdeSnapshot).toBeDefined();
    expect(procedures.base).toBeUndefined();
  });

  test("keeps extracted MCP server procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.upsertMcpServer).toBeDefined();
    expect(procedures.toggleMcpServer).toBeDefined();
    expect(procedures.trustMcpServer).toBeDefined();
    expect(procedures.probeMcpServer).toBeDefined();
    expect(procedures.mcpServer).toBeUndefined();
    expect(procedures.mcp).toBeUndefined();
  });

  test("keeps extracted MCP invocation procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.invokeMcpTool).toBeDefined();
    expect(procedures.readMcpResource).toBeDefined();
    expect(procedures.mcpInvocation).toBeUndefined();
  });

  test("keeps extracted MCP remote control procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.watchMcpNotifications).toBeDefined();
    expect(procedures.configureMcpRemoteControls).toBeDefined();
    expect(procedures.mcpRemoteControl).toBeUndefined();
  });

  test("keeps extracted provider procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.updateCapabilityState).toBeDefined();
    expect(procedures.testProvider).toBeDefined();
    expect(procedures.selectProviderModel).toBeDefined();
    expect(procedures.clearProviderModel).toBeDefined();
    expect(procedures.provider).toBeUndefined();
  });

  test("keeps extracted Project Memory procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.refreshProjectIndex).toBeDefined();
    expect(procedures.searchProjectIndex).toBeDefined();
    expect(procedures.buildProjectMemoryContext).toBeDefined();
    expect(procedures.upsertProjectMemoryPreset).toBeDefined();
    expect(procedures.deleteProjectMemoryPreset).toBeDefined();
    expect(procedures.projectMemory).toBeUndefined();
  });

  test("keeps extracted ACP activity diagnostics procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.exportAcpActivity).toBeDefined();
    expect(procedures.retryAcpActivityStream).toBeDefined();
    expect(procedures.replayAcpActivity).toBeDefined();
    expect(procedures.acpActivityDiagnostics).toBeUndefined();
    expect(procedures.acpActivity).toBeUndefined();
  });

  test("keeps extracted ACP replay preset procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.saveAcpReplayPreset).toBeDefined();
    expect(procedures.deleteAcpReplayPreset).toBeDefined();
    expect(procedures.acpActivityPreset).toBeUndefined();
  });

  test("keeps extracted checkpoint base procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.createCheckpoint).toBeDefined();
    expect(procedures.previewCheckpoint).toBeDefined();
    expect(procedures.checkpointBase).toBeUndefined();
    expect(procedures.checkpoint).toBeUndefined();
  });

  test("keeps extracted checkpoint restore procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.restoreCheckpoint).toBeDefined();
    expect(procedures.restoreCheckpointFiles).toBeDefined();
    expect(procedures.restoreCheckpointHunks).toBeDefined();
    expect(procedures.checkpointRestore).toBeUndefined();
  });

  test("keeps extracted checkpoint conflict procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.shelveCheckpointConflicts).toBeDefined();
    expect(procedures.resolveCheckpointTrackedConflicts).toBeDefined();
    expect(procedures.resolveCheckpointTrackedConflictChoice).toBeDefined();
    expect(procedures.resolveCheckpointTrackedConflictHunks).toBeDefined();
    expect(procedures.checkpointConflict).toBeUndefined();
  });

  test("keeps extracted hook base procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.upsertHook).toBeDefined();
    expect(procedures.toggleHook).toBeDefined();
    expect(procedures.updateHookLifecyclePolicy).toBeDefined();
    expect(procedures.updateHookSchedulingPolicy).toBeDefined();
    expect(procedures.hookBase).toBeUndefined();
    expect(procedures.hook).toBeUndefined();
  });

  test("keeps extracted hook run and audit procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.trustHook).toBeDefined();
    expect(procedures.approveHookRun).toBeDefined();
    expect(procedures.runHook).toBeDefined();
    expect(procedures.reviewHookRun).toBeDefined();
    expect(procedures.exportHookRuns).toBeDefined();
    expect(procedures.hookRun).toBeUndefined();
  });

  test("keeps extracted hook batch procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.runHookBatch).toBeDefined();
    expect(procedures.hookBatch).toBeUndefined();
  });

  test("keeps extracted plugin base procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.upsertPlugin).toBeDefined();
    expect(procedures.installPluginPackage).toBeDefined();
    expect(procedures.revalidatePluginPackage).toBeDefined();
    expect(procedures.togglePlugin).toBeDefined();
    expect(procedures.pluginBase).toBeUndefined();
    expect(procedures.plugin).toBeUndefined();
  });

  test("keeps extracted plugin registry procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.upsertPluginRegistry).toBeDefined();
    expect(procedures.trustPluginRegistry).toBeDefined();
    expect(procedures.revokePluginRegistryTrust).toBeDefined();
    expect(procedures.revokePluginRegistrySigner).toBeDefined();
    expect(procedures.restorePluginRegistrySigner).toBeDefined();
    expect(procedures.refreshPluginRegistry).toBeDefined();
    expect(procedures.installPluginRegistryPackage).toBeDefined();
    expect(procedures.pluginRegistry).toBeUndefined();
  });

  test("keeps extracted plugin run and audit procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.updatePluginSchedulingPolicy).toBeDefined();
    expect(procedures.trustPlugin).toBeDefined();
    expect(procedures.updatePluginPermissionGrant).toBeDefined();
    expect(procedures.approvePluginRun).toBeDefined();
    expect(procedures.runPlugin).toBeDefined();
    expect(procedures.reviewPluginRun).toBeDefined();
    expect(procedures.exportPluginRuns).toBeDefined();
    expect(procedures.pluginRun).toBeUndefined();
  });

  test("keeps extracted plugin batch procedures on the flat settings interface", () => {
    const procedures = settingsRouter._def.procedures as Record<
      string,
      unknown
    >;

    expect(procedures.runPluginBatch).toBeDefined();
    expect(procedures.upsertPluginBatchPreset).toBeDefined();
    expect(procedures.deletePluginBatchPreset).toBeDefined();
    expect(procedures.runPluginBatchPreset).toBeDefined();
    expect(procedures.upsertPluginBatchSchedule).toBeDefined();
    expect(procedures.deletePluginBatchSchedule).toBeDefined();
    expect(procedures.runDuePluginBatchSchedules).toBeDefined();
    expect(procedures.pluginBatch).toBeUndefined();
  });
});
