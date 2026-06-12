import { describe, expect, test } from "bun:test";
import type {
  ApprovePluginRunInput,
  DeletePluginBatchPresetInput,
  DeletePluginBatchScheduleInput,
  ExportPluginRunsInput,
  InstallPluginPackageInput,
  InstallPluginRegistryPackageInput,
  PluginDescriptor,
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
} from "./contracts/plugins.contract";
import { PluginsService } from "./plugins.service";
import type { PluginsPort } from "./ports/plugins.port";

class PluginsPortStub implements PluginsPort {
  readonly toggleCalls: TogglePluginInput[] = [];
  private data: PluginsData;

  constructor(data: PluginsData) {
    this.data = data;
  }

  listPlugins(
    _userId: string,
    _input?: PluginProjectInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  upsertPlugin(
    _userId: string,
    input: UpsertPluginInput
  ): Promise<PluginsData> {
    this.data = {
      ...this.data,
      plugins: [
        ...this.data.plugins.filter((plugin) => plugin.id !== input.id),
        createPlugin({
          id: input.id ?? "plugin-created",
          name: input.name,
          command: input.command,
          args: input.args ?? [],
        }),
      ],
    };
    return Promise.resolve(this.data);
  }

  installPackage(
    _userId: string,
    _input: InstallPluginPackageInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  revalidatePackage(
    _userId: string,
    _input: RevalidatePluginPackageInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  upsertRegistry(
    _userId: string,
    _input: UpsertPluginRegistryInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  trustRegistry(
    _userId: string,
    _input: TrustPluginRegistryInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  revokeRegistryTrust(
    _userId: string,
    _input: RevokePluginRegistryTrustInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  revokeRegistrySigner(
    _userId: string,
    _input: RevokePluginRegistrySignerInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  restoreRegistrySigner(
    _userId: string,
    _input: RestorePluginRegistrySignerInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  refreshRegistry(
    _userId: string,
    _input: RefreshPluginRegistryInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  installRegistryPackage(
    _userId: string,
    _input: InstallPluginRegistryPackageInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  togglePlugin(
    _userId: string,
    input: TogglePluginInput
  ): Promise<PluginsData> {
    this.toggleCalls.push(input);
    this.data = {
      ...this.data,
      plugins: this.data.plugins.map((plugin) =>
        plugin.id === input.id ? { ...plugin, enabled: input.enabled } : plugin
      ),
    };
    return Promise.resolve(this.data);
  }

  updateSchedulingPolicy(
    _userId: string,
    input: UpdatePluginSchedulingPolicyInput
  ): Promise<PluginsData> {
    this.data = {
      ...this.data,
      schedulingPolicy: {
        ...this.data.schedulingPolicy,
        ...input,
      },
    };
    return Promise.resolve(this.data);
  }

  trustPlugin(_userId: string, _input: TrustPluginInput): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  updatePermissionGrant(
    _userId: string,
    _input: UpdatePluginPermissionGrantInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  approveRun(
    _userId: string,
    _input: ApprovePluginRunInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  runPlugin(_userId: string, _input: RunPluginInput): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  runBatch(_userId: string, _input: RunPluginBatchInput): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  upsertBatchPreset(
    _userId: string,
    _input: UpsertPluginBatchPresetInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  deleteBatchPreset(
    _userId: string,
    _input: DeletePluginBatchPresetInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  runBatchPreset(
    _userId: string,
    _input: RunPluginBatchPresetInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  upsertBatchSchedule(
    _userId: string,
    _input: UpsertPluginBatchScheduleInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  deleteBatchSchedule(
    _userId: string,
    _input: DeletePluginBatchScheduleInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  runDueBatchSchedules(
    _userId: string,
    _input?: RunDuePluginBatchSchedulesInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  reviewRun(
    _userId: string,
    _input: ReviewPluginRunInput
  ): Promise<PluginsData> {
    return Promise.resolve(this.data);
  }

  exportRuns(
    _userId: string,
    _input?: ExportPluginRunsInput
  ): Promise<PluginRunExport> {
    return Promise.resolve({
      schemaVersion: 1,
      exportedAt: "2026-06-12T00:00:00.000Z",
      projectRoot: "/repo",
      filters: {
        reviewState: "all",
        limit: 200,
      },
      redacted: true,
      stats: {
        total: 0,
        matching: 0,
        included: 0,
        reviewed: 0,
        open: 0,
        statuses: {
          success: 0,
          failed: 0,
          timeout: 0,
          disabled: 0,
        },
      },
      runs: [],
      diagnostics: [],
    });
  }
}

function createPlugin(
  overrides: Partial<PluginDescriptor> = {}
): PluginDescriptor {
  return {
    id: "plugin-1",
    name: "Formatter",
    enabled: true,
    policyPreset: "standard",
    scopes: ["process"],
    dependencyIds: [],
    envKeys: [],
    fingerprint: "sha256:plugin",
    trustStatus: "trusted",
    permissionFingerprint: "sha256:permission",
    permissionStatus: "granted",
    command: "node",
    args: ["plugin.js"],
    timeoutMs: 5000,
    sourcePath: "/repo/.eragear/plugins.json",
    updatedAt: "2026-06-12T00:00:00.000Z",
    runConfirmationToken: "RUN PLUGIN",
    runOperation: {
      operation: "manual-run",
      fingerprint: "sha256:operation",
      approvalStatus: "missing",
      workspaceAccess: "sandbox",
      cwd: "/repo/.eragear/plugin-sandbox",
      command: "node",
      args: ["plugin.js"],
      scopes: ["process"],
      envKeys: [],
      executionFingerprint: "sha256:execution",
      permissionFingerprint: "sha256:permission",
      diagnostics: [],
    },
    executionPolicy: {
      status: "allowed",
      blockers: [],
      warnings: [],
    },
    scheduling: {
      status: "ready",
      activeRuns: 0,
      maxConcurrentRuns: 1,
      cooldownMs: 0,
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

function createData(plugins: PluginDescriptor[]): PluginsData {
  return {
    configPath: "/repo/.eragear/plugins.json",
    schedulingPolicy: {
      enabled: true,
      maxConcurrentRuns: 1,
      cooldownMs: 0,
      diagnostics: [],
    },
    plugins,
    catalog: [
      {
        manifestPath: "/repo/.eragear/plugin-packages/example.json",
        status: "installable",
        name: "Example Package",
        expiryStatus: "valid",
        scopes: ["process"],
        envKeys: [],
        workspaceAccess: "sandbox",
        diagnostics: [],
      },
    ],
    registries: [
      {
        id: "registry-1",
        name: "Trusted Registry",
        url: "https://plugins.example.com/index.json",
        enabled: true,
        fingerprint: "sha256:registry",
        trustStatus: "trusted",
        status: "ready",
        updatedAt: "2026-06-12T00:00:00.000Z",
        diagnostics: [],
        packages: [
          {
            id: "package-1",
            manifestUrl: "https://plugins.example.com/package-1.json",
            signatureHash: "sha256:signature",
            publicKeyFingerprint: "sha256:public-key",
            status: "update-available",
            signingStatus: "trusted",
            diagnostics: [],
          },
        ],
      },
    ],
    recentRuns: [],
    recentBatches: [],
    batchPresets: [],
    batchSchedules: [
      {
        id: "schedule-1",
        name: "Nightly",
        presetId: "preset-1",
        enabled: true,
        intervalMs: 3_600_000,
        nextRunAt: "2026-06-12T01:00:00.000Z",
        status: "due",
        pluginIds: ["plugin-1"],
        pluginNames: ["Formatter"],
        operationFingerprints: {
          "plugin-1": "sha256:operation",
        },
        diagnostics: [],
      },
    ],
    dependencyGraph: {
      nodes: [],
      edges: [],
      diagnostics: [],
    },
  };
}

describe("PluginsService", () => {
  test("builds SDK, lifecycle, and marketplace overview", async () => {
    const service = new PluginsService(
      new PluginsPortStub(
        createData([
          createPlugin(),
          createPlugin({
            id: "plugin-2",
            enabled: false,
            trustStatus: "untrusted",
            permissionStatus: "missing",
          }),
          createPlugin({
            id: "plugin-3",
            packageExpiryStatus: "expired",
          }),
        ])
      )
    );

    const result = await service.getOverview("user-1");

    expect(result.sdk.manifestVersion).toBe("eragear.plugin.v1");
    expect(result.lifecycle.total).toBe(3);
    expect(result.lifecycle.ready).toBe(1);
    expect(result.lifecycle.needsTrust).toBe(1);
    expect(result.lifecycle.needsPermission).toBe(1);
    expect(result.lifecycle.packageBlocked).toBe(1);
    expect(result.lifecycle.dueSchedules).toBe(1);
    expect(result.marketplace.trustedRegistries).toBe(1);
    expect(result.marketplace.updateAvailablePackages).toBe(1);
  });

  test("delegates lifecycle mutations through the port", async () => {
    const port = new PluginsPortStub(createData([createPlugin()]));
    const service = new PluginsService(port);

    const result = await service.toggle("user-1", {
      id: "plugin-1",
      enabled: false,
    });

    expect(port.toggleCalls).toEqual([{ id: "plugin-1", enabled: false }]);
    expect(result.lifecycle.enabled).toBe(0);
    expect(result.lifecycle.disabled).toBe(1);
  });
});
