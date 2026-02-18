import { useEffect, useRef } from "react";
import type { TabKey } from "@/presentation/dashboard/dashboard-data";
import { DashboardViewProvider } from "@/presentation/dashboard/dashboard-view.context";
import type {
  DashboardViewActions,
  DashboardViewState,
} from "@/presentation/dashboard/dashboard-view.contract";
import { AddAgentModal } from "./components/add-agent-modal";
import { AddProjectModal } from "./components/add-project-modal";
import { AgentsTab } from "./components/agents-tab";
import { AuthTab } from "./components/auth-tab";
import { DashboardAlerts } from "./components/dashboard-alerts";
import { DashboardFooter } from "./components/dashboard-footer";
import { DashboardHeader } from "./components/dashboard-header";
import { DashboardLoading } from "./components/dashboard-loading";
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
  const { activeTab, isLoading } = state;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const prevActiveTabRef = useRef<TabKey | null>(null);

  useEffect(() => {
    // Reposition when tab changes so each section starts at the top
    if (!(activeTab && prevActiveTabRef.current)) {
      prevActiveTabRef.current = activeTab;
      return;
    }

    // Only scroll if tab actually changed
    if (activeTab !== prevActiveTabRef.current) {
      // Scroll the container, not the main element if we change the layout
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      prevActiveTabRef.current = activeTab;
    }
  }, [activeTab]);

  return (
    <DashboardViewProvider actions={actions} state={state}>
      <div
        className={`newsprint-dots pointer-events-none fixed inset-0 z-0 opacity-10 transition-opacity duration-300 ${
          isLoading ? "opacity-5" : "opacity-10"
        }`}
      />

      <div
        className="fixed inset-0 z-10 overflow-y-auto scroll-smooth"
        ref={scrollContainerRef}
      >
        <div
          className={`relative mx-auto flex min-h-screen w-full max-w-[1360px] flex-col bg-paper px-3 pb-8 shadow-[0_0_50px_rgba(0,0,0,0.1)] transition-all duration-300 sm:px-5 lg:px-6 ${
            isLoading ? "opacity-90" : "opacity-100"
          }`}
          id="main-content"
        >
          <DashboardHeader />

          {!isLoading && (
            <div className="mt-2 sm:mt-3">
              <MarqueeTicker />
            </div>
          )}

          <DashboardAlerts />

          <main
            aria-busy={isLoading}
            className="relative mt-5 flex-1 sm:mt-6 lg:mt-8"
          >
            <DashboardLoading />

            <div
              className={`dashboard-grid grid min-h-0 border-ink border-t-4 bg-paper transition-all duration-300 ${
                activeTab === "logs" ? "lg:grid-cols-1" : "lg:grid-cols-12"
              } ${isLoading ? "pointer-events-none opacity-50" : "opacity-100"}`}
              data-active-tab={activeTab}
            >
              <section
                className={`dashboard-main flex min-w-0 flex-col border-ink border-b-2 bg-paper p-3 transition-all duration-300 sm:p-4 lg:p-5 ${
                  activeTab === "logs"
                    ? "lg:col-span-1 lg:border-r-0"
                    : "lg:col-span-8 lg:border-r-4 lg:border-b-0"
                }`}
              >
                <SessionsTab />
                <ProjectsTab />
                <AgentsTab />
                <AuthTab />
                <SettingsTab />
                <LogsTab />
              </section>

              {activeTab !== "logs" && (
                <aside className="dashboard-side flex flex-col border-ink border-b-2 bg-[#f3f3ef] p-3 transition-all duration-300 sm:p-4 lg:col-span-4 lg:border-b-0 lg:p-5">
                  <div className="lg:sticky lg:top-[132px] lg:self-start">
                    <OverviewStats />
                  </div>
                </aside>
              )}
            </div>
          </main>

          <DashboardFooter />
        </div>
      </div>

      <AddProjectModal />
      <AddAgentModal />
      <EditAgentModals />
    </DashboardViewProvider>
  );
}
