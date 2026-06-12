import { z } from "zod";

export const PLUGIN_SDK_MANIFEST_VERSION = "eragear.plugin.v1";

export const PluginRunStatusSchema = z.enum([
  "success",
  "failed",
  "timeout",
  "disabled",
]);

export const PluginExecutionPolicyPresetSchema = z.enum([
  "standard",
  "restricted",
  "blocked",
]);

export const PluginBatchFailureModeSchema = z.enum([
  "continue",
  "stop-on-failure",
]);

export const PluginAuditReviewStateSchema = z.enum(["all", "reviewed", "open"]);

export const PluginScopeSchema = z.enum(["process", "project-root", "env"]);

export const PluginProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const UpsertPluginInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    enabled: z.boolean().optional(),
    policyPreset: PluginExecutionPolicyPresetSchema.optional(),
    scopes: z.array(PluginScopeSchema).optional(),
    dependencyIds: z.array(z.string().trim().min(1)).optional(),
    envKeys: z.array(z.string().trim().min(1)).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    workingDirectory: z.string().trim().min(1).optional(),
  })
  .strict();

export const InstallPluginPackageInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    manifestPath: z.string().trim().min(1).optional(),
    registryUrl: z.string().trim().url().optional(),
    packageId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const localMode = Boolean(value.manifestPath);
    const registryMode = Boolean(value.registryUrl || value.packageId);

    if (localMode && registryMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide either manifestPath or registryUrl/packageId, not both.",
        path: ["manifestPath"],
      });
    }

    if (!(localMode || (value.registryUrl && value.packageId))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide manifestPath or both registryUrl and packageId.",
        path: ["registryUrl"],
      });
    }
  });

export const RevalidatePluginPackageInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    pluginId: z.string().trim().min(1),
  })
  .strict();

export const UpsertPluginRegistryInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    url: z.string().trim().url(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const TrustPluginRegistryInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    registryId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

export const RevokePluginRegistryTrustInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    registryId: z.string().trim().min(1),
  })
  .strict();

export const RevokePluginRegistrySignerInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    registryId: z.string().trim().min(1),
    publicKeyFingerprint: z.string().trim().startsWith("sha256:"),
    reason: z.string().trim().max(240).optional(),
  })
  .strict();

export const RestorePluginRegistrySignerInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    registryId: z.string().trim().min(1),
    publicKeyFingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

export const RefreshPluginRegistryInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    registryId: z.string().trim().min(1),
  })
  .strict();

export const InstallPluginRegistryPackageInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    registryId: z.string().trim().min(1),
    packageId: z.string().trim().min(1),
  })
  .strict();

export const TogglePluginInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const TrustPluginInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    pluginId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

export const UpdatePluginPermissionGrantInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    pluginId: z.string().trim().min(1),
    permissionFingerprint: z.string().trim().startsWith("sha256:"),
    granted: z.boolean(),
  })
  .strict();

export const ApprovePluginRunInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    pluginId: z.string().trim().min(1),
    operationFingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

export const RunPluginInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    pluginId: z.string().trim().min(1),
    confirmation: z.string().trim().min(1),
    operationApprovalId: z.string().trim().min(1),
  })
  .strict();

export const RunPluginBatchInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    pluginIds: z.array(z.string().trim().min(1)).min(1).max(8),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
    confirmation: z.string().trim().min(1),
    failureMode: PluginBatchFailureModeSchema.optional(),
  })
  .strict();

export const UpsertPluginBatchPresetInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    pluginIds: z.array(z.string().trim().min(1)).min(1).max(8),
    failureMode: PluginBatchFailureModeSchema.optional(),
  })
  .strict();

export const DeletePluginBatchPresetInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    presetId: z.string().trim().min(1),
  })
  .strict();

export const RunPluginBatchPresetInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    presetId: z.string().trim().min(1),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
    confirmation: z.string().trim().min(1),
  })
  .strict();

export const UpsertPluginBatchScheduleInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    presetId: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    intervalMs: z.number().int().min(1000).max(86_400_000),
    nextRunAt: z.string().datetime().optional(),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
  })
  .strict();

export const DeletePluginBatchScheduleInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    scheduleId: z.string().trim().min(1),
  })
  .strict();

export const RunDuePluginBatchSchedulesInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    scheduleIds: z.array(z.string().trim().min(1)).optional(),
    now: z.string().datetime().optional(),
  })
  .strict()
  .optional();

export const ReviewPluginRunInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    runId: z.string().trim().min(1),
    reviewed: z.boolean(),
  })
  .strict();

export const ExportPluginRunsInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    reviewState: PluginAuditReviewStateSchema.optional(),
    status: PluginRunStatusSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict()
  .optional();

export const UpdatePluginSchedulingPolicyInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    maxConcurrentRuns: z.number().int().positive().max(4).optional(),
    cooldownMs: z.number().int().min(0).max(600_000).optional(),
  })
  .strict();

const ExecutionPolicySchema = z.object({
  status: z.enum(["allowed", "blocked"]),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});

const AutomationSchedulingStateSchema = z.object({
  status: z.enum(["ready", "paused", "cooldown", "parallel-limit"]),
  activeRuns: z.number().int().nonnegative(),
  maxConcurrentRuns: z.number().int().positive(),
  cooldownMs: z.number().int().nonnegative(),
  diagnostics: z.array(z.string()),
});

const AutomationSchedulingPolicySchema = z.object({
  enabled: z.boolean(),
  maxConcurrentRuns: z.number().int().positive(),
  cooldownMs: z.number().int().nonnegative(),
  updatedAt: z.string().optional(),
  diagnostics: z.array(z.string()),
});

export const PluginRunSchema = z.object({
  id: z.string().min(1),
  pluginId: z.string().min(1),
  pluginName: z.string().min(1),
  batchId: z.string().optional(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  status: PluginRunStatusSchema,
  stdout: z.string(),
  stderr: z.string(),
  diagnostics: z.array(z.string()),
  reviewedAt: z.string().optional(),
});

export const PluginDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
  policyPreset: PluginExecutionPolicyPresetSchema,
  installSource: z.enum(["manual", "signed-package"]).optional(),
  publisher: z.string().optional(),
  packageRegistryName: z.string().optional(),
  packageExpiryStatus: z.enum(["valid", "expired", "not-declared"]).optional(),
  packageGovernanceStatus: z
    .enum(["verified", "verification-failed"])
    .optional(),
  scopes: z.array(PluginScopeSchema),
  dependencyIds: z.array(z.string()),
  envKeys: z.array(z.string()),
  fingerprint: z.string().min(1),
  trustStatus: z.enum(["trusted", "untrusted", "changed"]),
  permissionFingerprint: z.string().min(1),
  permissionStatus: z.enum(["granted", "missing", "changed"]),
  command: z.string().min(1),
  args: z.array(z.string()),
  timeoutMs: z.number().int().positive(),
  workingDirectory: z.string().optional(),
  sourcePath: z.string().min(1),
  updatedAt: z.string().min(1),
  runConfirmationToken: z.string().min(1),
  runOperation: z.object({
    operation: z.literal("manual-run"),
    fingerprint: z.string().min(1),
    approvalStatus: z.enum([
      "missing",
      "approved",
      "expired",
      "consumed",
      "changed",
    ]),
    approvalId: z.string().optional(),
    workspaceAccess: z.enum(["project-root", "sandbox"]),
    cwd: z.string(),
    command: z.string().min(1),
    args: z.array(z.string()),
    scopes: z.array(PluginScopeSchema),
    envKeys: z.array(z.string()),
    executionFingerprint: z.string().min(1),
    permissionFingerprint: z.string().min(1),
    diagnostics: z.array(z.string()),
  }),
  executionPolicy: ExecutionPolicySchema,
  scheduling: AutomationSchedulingStateSchema,
  lastRun: PluginRunSchema.optional(),
  diagnostics: z.array(z.string()),
});

export const PluginCatalogItemSchema = z.object({
  manifestPath: z.string().min(1),
  status: z.enum(["installable", "installed", "update-available", "invalid"]),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  publisher: z.string().optional(),
  expiryStatus: z.enum(["valid", "expired", "not-declared"]),
  scopes: z.array(PluginScopeSchema),
  envKeys: z.array(z.string()),
  workspaceAccess: z.enum(["project-root", "sandbox"]),
  installedPluginId: z.string().optional(),
  diagnostics: z.array(z.string()),
});

export const PluginRegistryPackageSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  publisher: z.string().optional(),
  manifestUrl: z.string().min(1),
  signatureHash: z.string().min(1),
  publicKeyFingerprint: z.string().min(1),
  status: z.enum([
    "installable",
    "installed",
    "update-available",
    "invalid",
    "revoked",
  ]),
  signingStatus: z.enum(["trusted", "revoked"]),
  installedPluginId: z.string().optional(),
  diagnostics: z.array(z.string()),
});

export const PluginRegistryDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  enabled: z.boolean(),
  fingerprint: z.string().min(1),
  trustStatus: z.enum(["trusted", "untrusted", "changed"]),
  status: z.enum(["ready", "disabled", "untrusted", "failed", "empty"]),
  packages: z.array(PluginRegistryPackageSchema),
  updatedAt: z.string().min(1),
  diagnostics: z.array(z.string()),
});

const PluginBatchSchema = z.object({
  id: z.string().min(1),
  pluginIds: z.array(z.string()),
  pluginNames: z.array(z.string()),
  runIds: z.array(z.string()),
  failureMode: PluginBatchFailureModeSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  status: z.enum(["success", "partial", "failed", "blocked"]),
  counts: z.record(PluginRunStatusSchema, z.number().int().nonnegative()),
  diagnostics: z.array(z.string()),
});

const PluginBatchPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pluginIds: z.array(z.string()),
  pluginNames: z.array(z.string()),
  failureMode: PluginBatchFailureModeSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastRunBatchId: z.string().optional(),
  diagnostics: z.array(z.string()),
});

const PluginBatchScheduleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  presetId: z.string().min(1),
  presetName: z.string().optional(),
  enabled: z.boolean(),
  intervalMs: z.number().int().positive(),
  nextRunAt: z.string().min(1),
  status: z.enum([
    "due",
    "scheduled",
    "paused",
    "missing-preset",
    "stale-fingerprint",
  ]),
  pluginIds: z.array(z.string()),
  pluginNames: z.array(z.string()),
  operationFingerprints: z.record(z.string(), z.string()),
  diagnostics: z.array(z.string()),
});

const PluginDependencyGraphSchema = z.object({
  nodes: z.array(
    z.object({
      pluginId: z.string().min(1),
      pluginName: z.string().min(1),
      dependencyIds: z.array(z.string()),
      dependentIds: z.array(z.string()),
      status: z.enum(["ready", "missing-dependency", "cycle"]),
      diagnostics: z.array(z.string()),
    })
  ),
  edges: z.array(
    z.object({
      pluginId: z.string().min(1),
      pluginName: z.string().min(1),
      dependencyId: z.string().min(1),
      dependencyName: z.string().optional(),
      status: z.enum(["ready", "missing", "cycle"]),
    })
  ),
  diagnostics: z.array(z.string()),
});

export const PluginsDataSchema = z
  .object({
    configPath: z.string().min(1),
    schedulingPolicy: AutomationSchedulingPolicySchema,
    plugins: z.array(PluginDescriptorSchema),
    catalog: z.array(PluginCatalogItemSchema),
    registries: z.array(PluginRegistryDescriptorSchema),
    recentRuns: z.array(PluginRunSchema),
    recentBatches: z.array(PluginBatchSchema),
    batchPresets: z.array(PluginBatchPresetSchema),
    batchSchedules: z.array(PluginBatchScheduleSchema),
    dependencyGraph: PluginDependencyGraphSchema,
  })
  .strict();

export const PluginSdkManifestSchema = z
  .object({
    manifestVersion: z.literal(PLUGIN_SDK_MANIFEST_VERSION),
    manifestFileNames: z.array(z.string()),
    scopes: z.array(PluginScopeSchema),
    lifecycleOperations: z.array(z.string()),
    marketplaceHooks: z.array(z.string()),
    packageSecurity: z.array(z.string()),
    manifestExample: z.object({
      manifestVersion: z.literal(PLUGIN_SDK_MANIFEST_VERSION),
      id: z.string(),
      name: z.string(),
      command: z.string(),
      args: z.array(z.string()),
      scopes: z.array(PluginScopeSchema),
      workspaceAccess: z.enum(["project-root", "sandbox"]),
    }),
  })
  .strict();

export const PluginLifecycleSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    enabled: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    trusted: z.number().int().nonnegative(),
    needsTrust: z.number().int().nonnegative(),
    permissionGranted: z.number().int().nonnegative(),
    needsPermission: z.number().int().nonnegative(),
    policyBlocked: z.number().int().nonnegative(),
    schedulingBlocked: z.number().int().nonnegative(),
    packageBlocked: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    scheduledBatches: z.number().int().nonnegative(),
    dueSchedules: z.number().int().nonnegative(),
  })
  .strict();

export const PluginMarketplaceSummarySchema = z
  .object({
    localCatalogPackages: z.number().int().nonnegative(),
    installableCatalogPackages: z.number().int().nonnegative(),
    registries: z.number().int().nonnegative(),
    trustedRegistries: z.number().int().nonnegative(),
    registryPackages: z.number().int().nonnegative(),
    installableRegistryPackages: z.number().int().nonnegative(),
    installedRegistryPackages: z.number().int().nonnegative(),
    updateAvailablePackages: z.number().int().nonnegative(),
    revokedRegistryPackages: z.number().int().nonnegative(),
  })
  .strict();

export const PluginsOverviewSchema = PluginsDataSchema.extend({
  sdk: PluginSdkManifestSchema,
  lifecycle: PluginLifecycleSummarySchema,
  marketplace: PluginMarketplaceSummarySchema,
}).strict();

export const PluginRunExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().min(1),
  projectRoot: z.string().min(1),
  filters: z.object({
    reviewState: PluginAuditReviewStateSchema,
    status: PluginRunStatusSchema.optional(),
    limit: z.number().int().positive(),
  }),
  redacted: z.literal(true),
  stats: z.object({
    total: z.number().int().nonnegative(),
    matching: z.number().int().nonnegative(),
    included: z.number().int().nonnegative(),
    reviewed: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    statuses: z.record(PluginRunStatusSchema, z.number().int().nonnegative()),
  }),
  runs: z.array(PluginRunSchema),
  diagnostics: z.array(z.string()),
});

export type PluginProjectInput = z.infer<typeof PluginProjectInputSchema>;
export type UpsertPluginInput = z.infer<typeof UpsertPluginInputSchema>;
export type InstallPluginPackageInput = z.infer<
  typeof InstallPluginPackageInputSchema
>;
export type RevalidatePluginPackageInput = z.infer<
  typeof RevalidatePluginPackageInputSchema
>;
export type UpsertPluginRegistryInput = z.infer<
  typeof UpsertPluginRegistryInputSchema
>;
export type TrustPluginRegistryInput = z.infer<
  typeof TrustPluginRegistryInputSchema
>;
export type RevokePluginRegistryTrustInput = z.infer<
  typeof RevokePluginRegistryTrustInputSchema
>;
export type RevokePluginRegistrySignerInput = z.infer<
  typeof RevokePluginRegistrySignerInputSchema
>;
export type RestorePluginRegistrySignerInput = z.infer<
  typeof RestorePluginRegistrySignerInputSchema
>;
export type RefreshPluginRegistryInput = z.infer<
  typeof RefreshPluginRegistryInputSchema
>;
export type InstallPluginRegistryPackageInput = z.infer<
  typeof InstallPluginRegistryPackageInputSchema
>;
export type TogglePluginInput = z.infer<typeof TogglePluginInputSchema>;
export type TrustPluginInput = z.infer<typeof TrustPluginInputSchema>;
export type UpdatePluginPermissionGrantInput = z.infer<
  typeof UpdatePluginPermissionGrantInputSchema
>;
export type ApprovePluginRunInput = z.infer<typeof ApprovePluginRunInputSchema>;
export type RunPluginInput = z.infer<typeof RunPluginInputSchema>;
export type RunPluginBatchInput = z.infer<typeof RunPluginBatchInputSchema>;
export type UpsertPluginBatchPresetInput = z.infer<
  typeof UpsertPluginBatchPresetInputSchema
>;
export type DeletePluginBatchPresetInput = z.infer<
  typeof DeletePluginBatchPresetInputSchema
>;
export type RunPluginBatchPresetInput = z.infer<
  typeof RunPluginBatchPresetInputSchema
>;
export type UpsertPluginBatchScheduleInput = z.infer<
  typeof UpsertPluginBatchScheduleInputSchema
>;
export type DeletePluginBatchScheduleInput = z.infer<
  typeof DeletePluginBatchScheduleInputSchema
>;
export type RunDuePluginBatchSchedulesInput = z.infer<
  typeof RunDuePluginBatchSchedulesInputSchema
>;
export type ReviewPluginRunInput = z.infer<typeof ReviewPluginRunInputSchema>;
export type ExportPluginRunsInput = z.infer<typeof ExportPluginRunsInputSchema>;
export type UpdatePluginSchedulingPolicyInput = z.infer<
  typeof UpdatePluginSchedulingPolicyInputSchema
>;
export type PluginDescriptor = z.infer<typeof PluginDescriptorSchema>;
export type PluginsData = z.infer<typeof PluginsDataSchema>;
export type PluginSdkManifest = z.infer<typeof PluginSdkManifestSchema>;
export type PluginsOverview = z.infer<typeof PluginsOverviewSchema>;
export type PluginRunExport = z.infer<typeof PluginRunExportSchema>;
