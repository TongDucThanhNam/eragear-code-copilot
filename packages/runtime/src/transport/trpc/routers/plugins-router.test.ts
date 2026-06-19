import { describe, expect, test } from "bun:test";

function setRequiredAllowlistEnvForRouterImport(): void {
  const commandPolicy = JSON.stringify([
    { command: process.execPath, allowAnyArgs: true },
  ]);
  process.env.ALLOWED_AGENT_COMMAND_POLICIES = commandPolicy;
  process.env.ALLOWED_TERMINAL_COMMAND_POLICIES = commandPolicy;
  process.env.ALLOWED_ENV_KEYS = "PATH";
}

describe("pluginsRouter", () => {
  test("keeps extracted base procedures on the flat plugins interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { pluginsRouter } = await import("./plugins");
    const procedures = pluginsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.getOverview).toBeDefined();
    expect(procedures.getSdkManifest).toBeDefined();
    expect(procedures.upsert).toBeDefined();
    expect(procedures.installPackage).toBeDefined();
    expect(procedures.revalidatePackage).toBeDefined();
    expect(procedures.toggle).toBeDefined();
    expect(procedures.base).toBeUndefined();
  });

  test("keeps extracted registry procedures on the flat plugins interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { pluginsRouter } = await import("./plugins");
    const procedures = pluginsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.upsertRegistry).toBeDefined();
    expect(procedures.trustRegistry).toBeDefined();
    expect(procedures.revokeRegistryTrust).toBeDefined();
    expect(procedures.revokeRegistrySigner).toBeDefined();
    expect(procedures.restoreRegistrySigner).toBeDefined();
    expect(procedures.refreshRegistry).toBeDefined();
    expect(procedures.installRegistryPackage).toBeDefined();
    expect(procedures.registry).toBeUndefined();
  });

  test("keeps extracted batch procedures on the flat plugins interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { pluginsRouter } = await import("./plugins");
    const procedures = pluginsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.runBatch).toBeDefined();
    expect(procedures.upsertBatchPreset).toBeDefined();
    expect(procedures.deleteBatchPreset).toBeDefined();
    expect(procedures.runBatchPreset).toBeDefined();
    expect(procedures.upsertBatchSchedule).toBeDefined();
    expect(procedures.deleteBatchSchedule).toBeDefined();
    expect(procedures.runDueBatchSchedules).toBeDefined();
    expect(procedures.batch).toBeUndefined();
  });

  test("keeps extracted run and audit procedures on the flat plugins interface", async () => {
    setRequiredAllowlistEnvForRouterImport();
    const { pluginsRouter } = await import("./plugins");
    const procedures = pluginsRouter._def.procedures as Record<string, unknown>;

    expect(procedures.updateSchedulingPolicy).toBeDefined();
    expect(procedures.trust).toBeDefined();
    expect(procedures.updatePermissionGrant).toBeDefined();
    expect(procedures.approveRun).toBeDefined();
    expect(procedures.run).toBeDefined();
    expect(procedures.reviewRun).toBeDefined();
    expect(procedures.exportRuns).toBeDefined();
    expect(procedures.runAudit).toBeUndefined();
  });
});
