import { useEffect, useRef } from "react";
import type {
  ApiKeyCreateResponse,
  DashboardData,
  TabKey,
} from "@/presentation/dashboard/dashboard-data";
import { EMPTY_DASHBOARD_DATA } from "@/presentation/dashboard/dashboard-data";
import type { Settings } from "@/shared/types/settings.types";
import { AddAgentModal } from "./components/add-agent-modal";
import { AddProjectModal } from "./components/add-project-modal";
import { AgentsTab } from "./components/agents-tab";
import { AuthTab } from "./components/auth-tab";
import { DashboardFooter } from "./components/dashboard-footer";
import { DashboardHeader } from "./components/dashboard-header";
import { EditAgentModals } from "./components/edit-agent-modals";
import { LogsTab } from "./components/logs-tab";
import { MarqueeTicker } from "./components/marquee-ticker";
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
  isLoading?: boolean;
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
  isLoading,
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
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Reposition when tab changes so each section starts at the top.
    if (!activeTab) {
      return;
    }
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  return (
    <>
      {/* Dot Grid Texture */}
      <div className="newsprint-dots pointer-events-none fixed inset-0 z-0 opacity-10" />

      <div
        className="relative z-10 mx-auto flex min-h-screen max-w-screen-xl flex-col bg-paper px-4 shadow-[0_0_50px_rgba(0,0,0,0.1)]"
        id="main-content"
      >
        <DashboardHeader
          activeTab={activeTab}
          isLoading={isLoading}
          onTabChange={onTabChange}
        />

        <MarqueeTicker stats={data.stats} />

        <div className="mt-4 flex flex-col gap-4">
          {success && (
            <div className="fade-in flex border-2 border-ink bg-[#CC0000] p-0 font-mono text-paper text-sm shadow-news">
              <div className="bg-ink px-4 py-2 font-black uppercase tracking-widest">
                Update
              </div>
              <div className="flex-1 px-4 py-2 italic tracking-tight">
                {notice || "Settings saved successfully!"}
              </div>
            </div>
          )}

          {notice && !success && (
            <div className="fade-in flex border-2 border-ink bg-[#CC0000] p-0 font-mono text-paper text-sm shadow-news">
              <div className="bg-ink px-4 py-2 font-black uppercase tracking-widest">
                Notice
              </div>
              <div className="flex-1 px-4 py-2 italic tracking-tight">
                {notice}
              </div>
            </div>
          )}

          {errors?.general && (
            <div className="fade-in flex border-2 border-ink bg-[#CC0000] p-0 font-mono text-paper text-sm shadow-news">
              <div className="bg-ink px-4 py-2 font-black uppercase tracking-widest">
                Alert
              </div>
              <div className="flex-1 px-4 py-2 italic tracking-tight">
                {errors.general}
              </div>
            </div>
          )}

          {requiresRestart && requiresRestart.length > 0 && (
            <div className="fade-in flex border-2 border-ink bg-[#CC0000] p-0 font-mono text-paper text-sm shadow-news">
              <div className="bg-ink px-4 py-2 font-black uppercase tracking-widest">
                Restart
              </div>
              <div className="flex-1 px-4 py-2 italic tracking-tight">
                Changes to {requiresRestart.join(", ")} require server restart.
              </div>
            </div>
          )}
        </div>

        {/* Main Content - Takes remaining space and scrolls when overflow */}
        <main className="mt-6 flex-1 overflow-y-auto" ref={mainRef}>
          {/* Main Grid Layout */}
          <div className="dashboard-grid grid min-h-0 border-ink border-t-2 lg:grid-cols-12">
            {/* Left Column - Tabs & Content */}
            <div className="dashboard-main flex min-w-0 flex-col border-ink border-b-2 lg:col-span-8 lg:border-b-0 lg:border-r-2">
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
