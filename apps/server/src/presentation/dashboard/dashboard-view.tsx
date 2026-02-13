import { useEffect, useRef } from "react";
import { DashboardViewProvider } from "@/presentation/dashboard/dashboard-view.context";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "@/presentation/dashboard/dashboard-view.contract";
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
  state: DashboardViewState;
  actions: DashboardViewActions;
}

export function DashboardView({ state, actions }: DashboardViewProps) {
  const { activeTab, success, notice, errors, requiresRestart } = state;
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Reposition when tab changes so each section starts at the top.
    if (!activeTab) {
      return;
    }
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  return (
    <DashboardViewProvider actions={actions} state={state}>
      {/* Dot Grid Texture */}
      <div className="newsprint-dots pointer-events-none fixed inset-0 z-0 opacity-10" />

      <div
        className="relative z-10 mx-auto flex min-h-screen max-w-screen-xl flex-col bg-paper px-4 shadow-[0_0_50px_rgba(0,0,0,0.1)]"
        id="main-content"
      >
        <DashboardHeader />

        <MarqueeTicker />

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
            <div className="dashboard-main flex min-w-0 flex-col border-ink border-b-2 lg:col-span-8 lg:border-r-2 lg:border-b-0">
              <SessionsTab />
              <ProjectsTab />
              <AgentsTab />
              <AuthTab />
              <SettingsTab />
              <LogsTab />
            </div>

            {/* Right Column - Overview Stats (Inverted Section) */}
            <div className="dashboard-side flex flex-col lg:col-span-4">
              <OverviewStats />
            </div>
          </div>
        </main>

        <DashboardFooter />
      </div>

      <AddProjectModal />
      <AddAgentModal />
      <EditAgentModals />
    </DashboardViewProvider>
  );
}
