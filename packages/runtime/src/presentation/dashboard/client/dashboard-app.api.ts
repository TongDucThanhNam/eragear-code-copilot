import type {
  ApiKeyCreateResponse,
  DashboardData,
} from "#runtime/presentation/dashboard/dashboard-data";
import type { Settings } from "#runtime/shared/types/settings.types";

export interface DashboardStatsResponse {
  stats?: DashboardData["stats"];
}

export interface DashboardProjectsResponse {
  projects?: DashboardData["projects"];
}

export interface DashboardSessionsResponse {
  sessions?: DashboardData["sessions"];
}

export interface AgentsResponse {
  agents?: DashboardData["agents"];
}

export interface ApiKeysResponse {
  keys?: DashboardData["apiKeys"];
}

export interface DeviceSessionsResponse {
  sessions?: DashboardData["deviceSessions"];
}

export interface ApiKeyCreateEnvelope {
  apiKey: ApiKeyCreateResponse;
}

export interface SettingsResponse extends Settings {
  requiresRestart?: string[];
}

export const FALLBACK_SETTINGS: Settings = {
  ui: {
    theme: "system",
    accentColor: "#2563eb",
    density: "comfortable",
    fontScale: 1,
    showReasoning: true,
  },
  projectRoots: [],
  mcpServers: [],
  app: {
    sessionIdleTimeoutMs: 10 * 60 * 1000,
    sessionListPageMaxLimit: 500,
    sessionMessagesPageMaxLimit: 200,
    logLevel: "info",
    maxTokens: 8192,
    defaultModel: "",
    supervisorEnabled: false,
    supervisorModel: "",
    supervisorMiniMaxApiKey: "",
    supervisorDecisionTimeoutMs: 30_000,
    supervisorDecisionMaxAttempts: 2,
    supervisorMaxRuntimeMs: 1_800_000,
    supervisorMaxRepeatedPrompts: 20,
    supervisorCustomSystemPrompt: "",
    supervisorToolPolicy: "builtin",
    supervisorToolAllowlist: [],
    supervisorWebSearchProvider: "none",
    supervisorWebSearchApiKey: "",
    supervisorMemoryProvider: "none",
    supervisorObsidianCommand: "obsidian",
    supervisorObsidianVault: "",
    supervisorObsidianBlueprintPath: "",
    supervisorObsidianLogPath: "",
    supervisorObsidianSearchPath: "Project",
    supervisorObsidianSearchLimit: 3,
    supervisorObsidianTimeoutMs: 5000,
    projectIndexEmbeddingEndpoint: "",
    projectIndexEmbeddingModel: "text-embedding-3-small",
    projectIndexEmbeddingApiKey: "",
    projectIndexEmbeddingTimeoutMs: 10_000,
    acpPromptMetaPolicy: "allowlist",
    acpPromptMetaAllowlist: [],
  },
};

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // Ignore JSON parse errors.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}
