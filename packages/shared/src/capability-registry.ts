export type CapabilityKind =
  | "skill"
  | "command"
  | "subagent"
  | "mcp-server"
  | "model-provider"
  | "output-style"
  | "hook"
  | "plugin";

export type CapabilityScope = "user" | "project" | "local" | "plugin";
export type CapabilityRegistryStorageKind =
  | "sqlite"
  | "filesystem-discovery"
  | "runtime-diagnostic";

export interface CapabilityPersistencePlan {
  primaryStore: "sqlite";
  tableName: "capabilities";
  migrationOwner: "packages/runtime/drizzle";
  notes: string[];
}

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  name: string;
  description?: string;
  scope: CapabilityScope;
  enabled: boolean;
  sourcePath?: string;
  pluginId?: string;
  tags?: string[];
  storage?: CapabilityRegistryStorageKind;
  diagnostics?: string[];
}

export interface CapabilityRegistryDiagnostics {
  status: "ready" | "degraded" | "disabled";
  enabledCount: number;
  disabledCount: number;
  missingDependencyCount: number;
  messages: string[];
}

export interface CapabilityRegistrySnapshot {
  capabilities: CapabilityDescriptor[];
  diagnostics: CapabilityRegistryDiagnostics;
  persistence: CapabilityPersistencePlan;
  updatedAt: string;
}

export const SQLITE_CAPABILITY_PERSISTENCE_PLAN: CapabilityPersistencePlan = {
  primaryStore: "sqlite",
  tableName: "capabilities",
  migrationOwner: "packages/runtime/drizzle",
  notes: [
    "Runtime diagnostics may discover capabilities before a durable row exists.",
    "Future migrations should store user/project/plugin capability records in SQLite, not JSON.",
    "Filesystem discovery should write normalized capability metadata through the repository port.",
  ],
};

export function createCapabilityRegistrySnapshot(
  capabilities: CapabilityDescriptor[],
  messages: string[] = []
): CapabilityRegistrySnapshot {
  const enabledCount = capabilities.filter((item) => item.enabled).length;
  const disabledCount = capabilities.length - enabledCount;
  const missingDependencyCount = capabilities.filter((item) =>
    item.diagnostics?.some((message) =>
      message.toLowerCase().includes("not found")
    )
  ).length;

  return {
    capabilities,
    diagnostics: {
      status: missingDependencyCount > 0 ? "degraded" : "ready",
      enabledCount,
      disabledCount,
      missingDependencyCount,
      messages,
    },
    persistence: SQLITE_CAPABILITY_PERSISTENCE_PLAN,
    updatedAt: new Date().toISOString(),
  };
}
