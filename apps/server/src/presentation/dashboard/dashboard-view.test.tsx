import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { EMPTY_DASHBOARD_DATA } from "@/presentation/dashboard/dashboard-data";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "@/presentation/dashboard/dashboard-view.contract";
import {
  useDashboardActions,
  useDashboardState,
} from "@/presentation/dashboard/dashboard-view.context";
import { DashboardView } from "@/presentation/dashboard/dashboard-view";

const baseState: DashboardViewState = {
  settings: {
    ui: {
      theme: "system",
      accentColor: "#2563eb",
      density: "comfortable",
      fontScale: 1,
    },
    projectRoots: [],
    mcpServers: [],
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
