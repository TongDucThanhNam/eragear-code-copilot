import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { EMPTY_DASHBOARD_DATA } from "#runtime/presentation/dashboard/dashboard-data";
import { DashboardView } from "#runtime/presentation/dashboard/dashboard-view";
import {
  useDashboardActions,
  useDashboardState,
} from "#runtime/presentation/dashboard/dashboard-view.context";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "#runtime/presentation/dashboard/dashboard-view.contract";

const baseState: DashboardViewState = {
  settings: {
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
  },
  dashboardData: EMPTY_DASHBOARD_DATA,
  activeTab: "sessions",
  notice: "Saved",
  success: true,
  requiresRestart: ["projectRoots"],
};

const noopAsync = async (): Promise<void> => undefined;
const baseActions: DashboardViewActions = {
  navigation: {
    onTabChange: () => undefined,
  },
  sessions: {
    onRefreshSessions: () => undefined,
    onStopSession: noopAsync,
    onDeleteSession: noopAsync,
  },
  projects: {
    onCreateProject: noopAsync,
  },
  agents: {
    onCreateAgent: noopAsync,
    onUpdateAgent: noopAsync,
    onDeleteAgent: noopAsync,
  },
  auth: {
    onCreateApiKey: noopAsync,
    onDeleteApiKey: noopAsync,
    onActivateDeviceSession: noopAsync,
    onRevokeDeviceSession: noopAsync,
  },
  settings: {
    onSaveSettings: noopAsync,
  },
};

function StateHookProbe() {
  useDashboardState();
  return null;
}

function ActionsHookProbe() {
  useDashboardActions();
  return null;
}

describe("DashboardView", () => {
  test("renders successfully with provider-backed components", () => {
    const html = renderToString(
      <DashboardView actions={baseActions} state={baseState} />
    );

    expect(html).toContain("Eragear Server");
    expect(html).toContain("Sessions");
    expect(html).toContain("projectRoots");
    expect(html).toContain("require server restart.");
  });

  test("mounts only the active tab on initial render", () => {
    const html = renderToString(
      <DashboardView actions={baseActions} state={baseState} />
    );

    expect(html).toContain('id="tab-sessions"');
    expect(html).not.toContain('id="tab-projects"');
    expect(html).not.toContain('id="tab-agents"');
    expect(html).not.toContain('id="tab-auth"');
    expect(html).not.toContain('id="tab-settings"');
    expect(html).not.toContain('id="tab-logs"');
  });

  test("throws for state hook usage outside provider", () => {
    expect(() => renderToString(<StateHookProbe />)).toThrow(
      "useDashboardState must be used within DashboardViewProvider"
    );
  });

  test("throws for actions hook usage outside provider", () => {
    expect(() => renderToString(<ActionsHookProbe />)).toThrow(
      "useDashboardActions must be used within DashboardViewProvider"
    );
  });
});
