import {
  type ApiKeyCreateResponse,
  type DashboardData,
  EMPTY_DASHBOARD_DATA,
  type TabKey,
} from "@/presentation/dashboard/dashboard-data";
import type { DashboardBootstrap } from "@/presentation/dashboard/dashboard-types";
import { DashboardView } from "@/presentation/dashboard/dashboard-view";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "@/presentation/dashboard/dashboard-view.contract";
import type { Settings } from "@/shared/types/settings.types";
import { normalizeTab } from "../utils";
import { getUiAssets } from "./ui-assets";

interface DashboardPageProps {
  settings: Settings;
  dashboardData?: DashboardData;
  activeTab?: string;
  errors?: DashboardBootstrap["errors"];
  success?: boolean;
  notice?: string;
  requiresRestart?: string[];
  createdApiKey?: ApiKeyCreateResponse;
}

const noop = (): void => undefined;
const noopTab = (_tab: TabKey): void => undefined;
const noopAsync = (): Promise<void> => Promise.resolve();

function serializeBootstrap(bootstrap: DashboardBootstrap): string {
  return JSON.stringify(bootstrap).replace(/</g, "\\u003c");
}

export function DashboardPage({
  settings,
  dashboardData,
  activeTab,
  errors,
  success,
  notice,
  requiresRestart,
  createdApiKey,
}: DashboardPageProps) {
  const assets = getUiAssets();
  const tab = normalizeTab(activeTab);
  const data = dashboardData ?? EMPTY_DASHBOARD_DATA;

  const bootstrap: DashboardBootstrap = {
    settings,
    dashboardData: data,
    activeTab: tab,
    errors,
    success,
    notice,
    requiresRestart,
    createdApiKey,
  };
  const state: DashboardViewState = {
    settings,
    dashboardData: data,
    activeTab: tab,
    errors,
    success,
    notice,
    requiresRestart,
    createdApiKey,
  };
  const actions: DashboardViewActions = {
    navigation: {
      onTabChange: noopTab,
    },
    sessions: {
      onRefreshSessions: noop,
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

  return (
    <>
      <div data-active-tab={tab} id="client-root">
        <DashboardView actions={actions} state={state} />
      </div>
      <script id="dashboard-bootstrap" type="application/json">
        {serializeBootstrap(bootstrap)}
      </script>
      {assets.clientEntry && <script src={assets.clientEntry} type="module" />}
    </>
  );
}
