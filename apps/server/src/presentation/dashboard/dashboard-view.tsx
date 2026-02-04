import type { Settings } from "@/shared/types/settings.types";
import type {
  ApiKeyCreateResponse,
  DashboardData,
  TabKey,
} from "@/presentation/dashboard/dashboard-data";
import { EMPTY_DASHBOARD_DATA } from "@/presentation/dashboard/dashboard-data";
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

interface DashboardViewProps {
  settings: Settings;
  dashboardData?: DashboardData;
  activeTab: TabKey;
  errors?: {
    projectRoots?: string;
    general?: string;
  };
  success?: boolean;
  notice?: string;
  requiresRestart?: string[];
  createdApiKey?: ApiKeyCreateResponse;
  onTabChange: (tab: TabKey) => void;
  onRefreshSessions: () => void;
  onStopSession: (chatId: string) => void;
  onDeleteSession: (chatId: string) => void;
  onCreateProject: (input: {
    name: string;
    path: string;
    description?: string;
  }) => Promise<void>;
  onCreateAgent: (input: {
    name: string;
    type: string;
    command: string;
    argsInput?: string;
  }) => Promise<void>;
  onUpdateAgent: (input: {
    id: string;
    name: string;
    type: string;
    command: string;
    argsInput?: string;
  }) => Promise<void>;
  onDeleteAgent: (agentId: string) => Promise<void>;
  onCreateApiKey: (input: {
    name?: string;
    prefix?: string;
    expiresInDays?: number;
  }) => Promise<void>;
  onDeleteApiKey: (keyId: string) => Promise<void>;
  onActivateDeviceSession: (token: string) => Promise<void>;
  onRevokeDeviceSession: (token: string) => Promise<void>;
  onSaveSettings: (formData: FormData) => Promise<void>;
}

export function DashboardView({
  settings,
  dashboardData,
  activeTab,
  errors,
  success,
  notice,
  requiresRestart,
  createdApiKey,
  onTabChange,
  onRefreshSessions,
  onStopSession,
  onDeleteSession,
  onCreateProject,
  onCreateAgent,
  onUpdateAgent,
  onDeleteAgent,
  onCreateApiKey,
  onDeleteApiKey,
  onActivateDeviceSession,
  onRevokeDeviceSession,
  onSaveSettings,
}: DashboardViewProps) {
  const data = dashboardData ?? EMPTY_DASHBOARD_DATA;

  return (
    <>
      {/* Dot Grid Texture */}
      <div className="newsprint-dots pointer-events-none fixed inset-0 z-0" />

      <div
        className="relative z-10 mx-auto flex h-dvh max-w-screen-xl flex-col px-4"
        id="main-content"
      >
        <DashboardHeader activeTab={activeTab} onTabChange={onTabChange} />

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
              <SessionsTab
                activeTab={activeTab}
                onDeleteSession={onDeleteSession}
                onRefreshSessions={onRefreshSessions}
                onStopSession={onStopSession}
                sessions={data.sessions}
              />
              <ProjectsTab activeTab={activeTab} projects={data.projects} />
              <AgentsTab
                activeTab={activeTab}
                agentStats={data.stats.agentStats}
                agents={data.agents}
                onDeleteAgent={onDeleteAgent}
              />
              <AuthTab
                activeTab={activeTab}
                apiKeys={data.apiKeys}
                createdApiKey={createdApiKey}
                deviceSessions={data.deviceSessions}
                onActivateDeviceSession={onActivateDeviceSession}
                onCreateApiKey={onCreateApiKey}
                onDeleteApiKey={onDeleteApiKey}
                onRevokeDeviceSession={onRevokeDeviceSession}
              />
              <SettingsTab
                activeTab={activeTab}
                errors={errors}
                onSaveSettings={onSaveSettings}
                settings={settings}
              />
              <LogsTab activeTab={activeTab} />
            </div>

            {/* Right Column - Overview Stats (Inverted Section) */}
            <div className="dashboard-side flex flex-col lg:col-span-4">
              <OverviewStats stats={data.stats} />
            </div>
          </div>
        </main>

        <DashboardFooter />
      </div>

      <AddProjectModal onCreateProject={onCreateProject} />
      <AddAgentModal onCreateAgent={onCreateAgent} />
      <EditAgentModals agents={data.agents} onUpdateAgent={onUpdateAgent} />
    </>
  );
}
