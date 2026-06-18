import { describe, expect, test } from "bun:test";
import {
  ApprovePluginRunRequestSchema,
  DeletePluginBatchPresetRequestSchema,
  DeletePluginBatchScheduleRequestSchema,
  ExportPluginRunsRequestSchema,
  InstallPluginPackageRequestSchema,
  InstallPluginRegistryPackageRequestSchema,
  RefreshPluginRegistryRequestSchema,
  RestorePluginRegistrySignerRequestSchema,
  RevalidatePluginPackageRequestSchema,
  ReviewPluginRunRequestSchema,
  RevokePluginRegistrySignerRequestSchema,
  RevokePluginRegistryTrustRequestSchema,
  RunDuePluginBatchSchedulesRequestSchema,
  RunPluginBatchPresetRequestSchema,
  RunPluginBatchRequestSchema,
  RunPluginRequestSchema,
  TogglePluginRequestSchema,
  TrustPluginRegistryRequestSchema,
  TrustPluginRequestSchema,
  UpdatePluginPermissionGrantRequestSchema,
  UpsertPluginBatchPresetRequestSchema,
  UpsertPluginBatchScheduleRequestSchema,
  UpsertPluginRegistryRequestSchema,
  UpsertPluginRequestSchema,
} from "./settings-plugin-router-data";

function ids(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

describe("settings plugin request schemas", () => {
  test("accepts canonical project-local plugin upserts", () => {
    expect(
      UpsertPluginRequestSchema.parse({
        projectId: "project-1",
        id: "plugin-1",
        name: " format plugin ",
        description: "Runs formatter",
        enabled: true,
        policyPreset: "restricted",
        scopes: ["process", "project-root"],
        dependencyIds: [" plugin-base "],
        envKeys: [" PATH "],
        command: " bun ",
        args: ["run", "format"],
        timeoutMs: 5000,
        workingDirectory: "apps/server",
      })
    ).toEqual({
      projectId: "project-1",
      id: "plugin-1",
      name: "format plugin",
      description: "Runs formatter",
      enabled: true,
      policyPreset: "restricted",
      scopes: ["process", "project-root"],
      dependencyIds: ["plugin-base"],
      envKeys: ["PATH"],
      command: "bun",
      args: ["run", "format"],
      timeoutMs: 5000,
      workingDirectory: "apps/server",
    });
  });

  test("keeps plugin descriptors strict and scope-limited", () => {
    expect(
      UpsertPluginRequestSchema.safeParse({
        name: "format plugin",
        command: "bun",
        trustedFingerprint: "sha256:abc",
      }).success
    ).toBe(false);

    expect(
      UpsertPluginRequestSchema.safeParse({
        name: "format plugin",
        command: "bun",
        scopes: ["network"],
      }).success
    ).toBe(false);
  });

  test("keeps signed package install modes explicit", () => {
    expect(
      InstallPluginPackageRequestSchema.parse({
        projectId: "project-1",
        manifestPath: " plugins/plugin.json ",
      })
    ).toEqual({
      projectId: "project-1",
      manifestPath: "plugins/plugin.json",
    });

    expect(
      InstallPluginPackageRequestSchema.parse({
        registryUrl: " https://plugins.example.test/index.json ",
        packageId: " plugin.format ",
      })
    ).toEqual({
      registryUrl: "https://plugins.example.test/index.json",
      packageId: "plugin.format",
    });

    expect(
      InstallPluginPackageRequestSchema.safeParse({
        manifestPath: "plugins/plugin.json",
        registryUrl: "https://plugins.example.test/index.json",
        packageId: "plugin.format",
      }).success
    ).toBe(false);

    expect(
      InstallPluginPackageRequestSchema.safeParse({
        registryUrl: "https://plugins.example.test/index.json",
      }).success
    ).toBe(false);
  });

  test("keeps plugin registry and package requests narrow", () => {
    expect(
      UpsertPluginRegistryRequestSchema.parse({
        projectId: "project-1",
        id: "registry-1",
        name: " team registry ",
        url: " https://plugins.example.test/index.json ",
        enabled: true,
      })
    ).toEqual({
      projectId: "project-1",
      id: "registry-1",
      name: "team registry",
      url: "https://plugins.example.test/index.json",
      enabled: true,
    });

    expect(
      RevalidatePluginPackageRequestSchema.safeParse({
        pluginId: "plugin-1",
        packageId: "plugin.format",
      }).success
    ).toBe(false);

    expect(
      InstallPluginRegistryPackageRequestSchema.safeParse({
        registryId: "registry-1",
        packageId: " ",
      }).success
    ).toBe(false);
  });

  test("requires fingerprint-shaped plugin registry trust and signer requests", () => {
    expect(
      TrustPluginRegistryRequestSchema.parse({
        registryId: " registry-1 ",
        fingerprint: " sha256:abc ",
      })
    ).toEqual({
      registryId: "registry-1",
      fingerprint: "sha256:abc",
    });

    expect(
      RevokePluginRegistrySignerRequestSchema.parse({
        registryId: " registry-1 ",
        publicKeyFingerprint: " sha256:def ",
        reason: " rotated ",
      })
    ).toEqual({
      registryId: "registry-1",
      publicKeyFingerprint: "sha256:def",
      reason: "rotated",
    });

    expect(
      RestorePluginRegistrySignerRequestSchema.safeParse({
        registryId: "registry-1",
        publicKeyFingerprint: "def",
      }).success
    ).toBe(false);

    expect(
      RevokePluginRegistryTrustRequestSchema.safeParse({
        registryId: "registry-1",
        fingerprint: "sha256:abc",
      }).success
    ).toBe(false);

    expect(
      RefreshPluginRegistryRequestSchema.safeParse({
        registryId: "registry-1",
        dryRun: true,
      }).success
    ).toBe(false);
  });

  test("keeps plugin toggle, trust, permission, and approval requests strict", () => {
    expect(
      TogglePluginRequestSchema.safeParse({
        id: "plugin-1",
        enabled: true,
        command: "bun",
      }).success
    ).toBe(false);

    expect(
      TrustPluginRequestSchema.safeParse({
        pluginId: "plugin-1",
        fingerprint: "abc",
      }).success
    ).toBe(false);

    expect(
      UpdatePluginPermissionGrantRequestSchema.parse({
        pluginId: " plugin-1 ",
        permissionFingerprint: " sha256:perm ",
        granted: true,
      })
    ).toEqual({
      pluginId: "plugin-1",
      permissionFingerprint: "sha256:perm",
      granted: true,
    });

    expect(
      ApprovePluginRunRequestSchema.safeParse({
        pluginId: "plugin-1",
        operationFingerprint: "operation",
      }).success
    ).toBe(false);
  });

  test("keeps plugin run requests confirmation-backed", () => {
    expect(
      RunPluginRequestSchema.parse({
        pluginId: " plugin-1 ",
        confirmation: " run-plugin ",
        operationApprovalId: " approval-1 ",
      })
    ).toEqual({
      pluginId: "plugin-1",
      confirmation: "run-plugin",
      operationApprovalId: "approval-1",
    });

    expect(
      RunPluginRequestSchema.safeParse({
        pluginId: "plugin-1",
        confirmation: " ",
        operationApprovalId: "approval-1",
      }).success
    ).toBe(false);
  });

  test("bounds plugin batch requests and preset shapes", () => {
    expect(
      RunPluginBatchRequestSchema.parse({
        pluginIds: [" plugin-1 "],
        operationFingerprints: {
          " plugin-1 ": " sha256:abc ",
        },
        confirmation: " run-plugins ",
        failureMode: "stop-on-failure",
      })
    ).toEqual({
      pluginIds: ["plugin-1"],
      operationFingerprints: {
        "plugin-1": "sha256:abc",
      },
      confirmation: "run-plugins",
      failureMode: "stop-on-failure",
    });

    expect(
      RunPluginBatchRequestSchema.safeParse({
        pluginIds: ids(9, "plugin"),
        operationFingerprints: {},
        confirmation: "run-plugins",
      }).success
    ).toBe(false);

    expect(
      UpsertPluginBatchPresetRequestSchema.safeParse({
        name: "x".repeat(81),
        pluginIds: ["plugin-1"],
      }).success
    ).toBe(false);
  });

  test("bounds scheduled plugin batch requests", () => {
    expect(
      UpsertPluginBatchScheduleRequestSchema.parse({
        id: " schedule-1 ",
        name: " nightly format ",
        presetId: " preset-1 ",
        enabled: true,
        intervalMs: 60_000,
        nextRunAt: "2026-06-17T00:00:00.000Z",
        operationFingerprints: {
          " plugin-1 ": " sha256:abc ",
        },
      })
    ).toEqual({
      id: "schedule-1",
      name: "nightly format",
      presetId: "preset-1",
      enabled: true,
      intervalMs: 60_000,
      nextRunAt: "2026-06-17T00:00:00.000Z",
      operationFingerprints: {
        "plugin-1": "sha256:abc",
      },
    });

    expect(
      UpsertPluginBatchScheduleRequestSchema.safeParse({
        name: "nightly format",
        presetId: "preset-1",
        intervalMs: 999,
        operationFingerprints: {},
      }).success
    ).toBe(false);

    expect(
      RunDuePluginBatchSchedulesRequestSchema.parse(undefined)
    ).toBeUndefined();

    expect(
      RunDuePluginBatchSchedulesRequestSchema.safeParse({
        scheduleIds: ["schedule-1"],
        now: "not-a-date",
      }).success
    ).toBe(false);
  });

  test("keeps batch preset, review, and export requests narrow", () => {
    expect(
      DeletePluginBatchScheduleRequestSchema.safeParse({
        scheduleId: "schedule-1",
        presetId: "preset-1",
      }).success
    ).toBe(false);

    expect(
      DeletePluginBatchPresetRequestSchema.parse({
        presetId: " preset-1 ",
      })
    ).toEqual({
      presetId: "preset-1",
    });

    expect(
      RunPluginBatchPresetRequestSchema.safeParse({
        presetId: "preset-1",
        operationFingerprints: {},
        confirmation: " ",
      }).success
    ).toBe(false);

    expect(
      ReviewPluginRunRequestSchema.parse({
        runId: " run-1 ",
        reviewed: true,
      })
    ).toEqual({
      runId: "run-1",
      reviewed: true,
    });

    expect(ExportPluginRunsRequestSchema.parse(undefined)).toBeUndefined();

    expect(
      ExportPluginRunsRequestSchema.safeParse({
        reviewState: "open",
        status: "failed",
        limit: 201,
      }).success
    ).toBe(false);
  });
});
