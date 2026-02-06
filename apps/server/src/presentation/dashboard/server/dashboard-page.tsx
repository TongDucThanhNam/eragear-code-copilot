import {
  type ApiKeyCreateResponse,
  type DashboardData,
  EMPTY_DASHBOARD_DATA,
} from "@/presentation/dashboard/dashboard-data";
import type { DashboardBootstrap } from "@/presentation/dashboard/dashboard-types";
import { DashboardView } from "@/presentation/dashboard/dashboard-view";
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

  return (
    <>
      <div data-active-tab={tab} id="client-root">
        <DashboardView
          activeTab={tab}
          createdApiKey={createdApiKey}
          dashboardData={data}
          errors={errors}
          notice={notice}
          onActivateDeviceSession={noopAsync}
          onCreateAgent={noopAsync}
          onCreateApiKey={noopAsync}
          onCreateProject={noopAsync}
          onDeleteAgent={noopAsync}
          onDeleteApiKey={noopAsync}
          onDeleteSession={noopAsync}
          onRefreshSessions={noop}
          onRevokeDeviceSession={noopAsync}
          onSaveSettings={noopAsync}
          onStopSession={noopAsync}
          onTabChange={noop}
          onUpdateAgent={noopAsync}
          requiresRestart={requiresRestart}
          settings={settings}
          success={success}
        />
      </div>
      <script id="dashboard-bootstrap" type="application/json">
        {serializeBootstrap(bootstrap)}
      </script>
      {assets.clientEntry && <script src={assets.clientEntry} type="module" />}
    </>
  );
}
