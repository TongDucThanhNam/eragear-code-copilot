import type { Settings } from "@/shared/types/settings.types";
import type {
  ApiKeyCreateResponse,
  DashboardData,
} from "@/transport/http/ui/dashboard-data";
import { AddAgentModal } from "./components/add-agent-modal";
import { AddProjectModal } from "./components/add-project-modal";
import { AgentsTab } from "./components/agents-tab";
import { AuthTab } from "./components/auth-tab";
import { DashboardFooter } from "./components/dashboard-footer";
import { DashboardHeader } from "./components/dashboard-header";
import { EditAgentModals } from "./components/edit-agent-modals";
import { LogsTab } from "./components/logs-tab";
import { OverviewStats } from "./components/overview-stats";
import { ProjectsTab } from "./components/projects-tab";
import { SessionsTab } from "./components/sessions-tab";
import { SettingsTab } from "./components/settings-tab";
import { getUiAssets } from "./ui-assets";
import { normalizeTab } from "./utils";

interface ConfigPageProps {
  settings: Settings;
  errors?: {
    projectRoots?: string;
    general?: string;
  };
  success?: boolean;
  notice?: string;
  requiresRestart?: string[];
  dashboardData?: DashboardData;
  activeTab?: string;
  createdApiKey?: ApiKeyCreateResponse;
}

export function ConfigPage({
  settings,
  errors,
  success,
  notice,
  requiresRestart,
  dashboardData,
  activeTab,
  createdApiKey,
}: ConfigPageProps) {
  const assets = getUiAssets();
  const tab = normalizeTab(activeTab);
  const data: DashboardData =
    dashboardData ??
    ({
      stats: {
        totalProjects: 0,
        totalSessions: 0,
        activeSessions: 0,
        recentSessions24h: 0,
        weeklySessions: 0,
        agentStats: {},
        serverUptime: 0,
      },
      projects: [],
      sessions: [],
      agents: [],
      apiKeys: [],
      deviceSessions: [],
    } satisfies DashboardData);

  return (
    <>
      {/* Dot Grid Texture */}
      <div className="newsprint-dots pointer-events-none fixed inset-0 z-0" />

      <div
        className="relative z-10 mx-auto flex h-dvh max-w-screen-xl flex-col px-4"
        id="main-content"
      >
        <DashboardHeader activeTab={tab} />

        {success && (
          <div className="fade-in mb-4 border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-sm">
            ✓ {notice || "Settings saved successfully!"}
          </div>
        )}

        {notice && !success && (
          <div className="fade-in mb-4 border-2 border-ink bg-accent/10 px-4 py-3 font-mono text-sm">
            ✓ {notice}
          </div>
        )}

        {errors?.general && (
          <div className="fade-in mb-4 border-2 border-red-700 bg-red-50 px-4 py-3 font-mono text-red-800 text-sm">
            ⚠ {errors.general}
          </div>
        )}

        {requiresRestart && requiresRestart.length > 0 && (
          <div className="fade-in mb-4 border-2 border-red-700 bg-red-50 px-4 py-3 font-mono text-red-800 text-sm">
            ⚠ Changes to {requiresRestart.join(", ")} require server restart.
          </div>
        )}

        {/* Main Content - Takes remaining space and scrolls when overflow */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* Main Grid Layout */}
          <div className="dashboard-grid grid min-h-0 gap-6 lg:grid-cols-12">
            {/* Left Column - Tabs & Content */}
            <div className="dashboard-main flex min-w-0 flex-col lg:col-span-8">
              <SessionsTab activeTab={tab} sessions={data.sessions} />
              <ProjectsTab activeTab={tab} projects={data.projects} />
              <AgentsTab
                activeTab={tab}
                agentStats={data.stats.agentStats}
                agents={data.agents}
              />
              <AuthTab
                activeTab={tab}
                apiKeys={data.apiKeys}
                createdApiKey={createdApiKey}
                deviceSessions={data.deviceSessions}
              />
              <SettingsTab
                activeTab={tab}
                errors={errors}
                settings={settings}
              />
              <LogsTab activeTab={tab} />
            </div>

            {/* Right Column - Overview Stats (Inverted Section) */}
            <div className="dashboard-side flex flex-col lg:col-span-4">
              <OverviewStats stats={data.stats} />
            </div>
          </div>
        </main>

        <DashboardFooter />
      </div>

      <AddProjectModal />
      <AddAgentModal />
      <EditAgentModals agents={data.agents} />

      <div data-active-tab={tab} id="client-root" />
      {assets.clientEntry && <script src={assets.clientEntry} type="module" />}
    </>
  );
}

export function SettingsForm({ settings }: { settings: Settings }) {
  return <ConfigPage settings={settings} />;
}
