import {
  useDashboardActions,
  useDashboardState,
} from "@/presentation/dashboard/dashboard-view.context";
import { SessionRow } from "./session-row";
import { TabPanel } from "./tab-panel";

export function SessionsTab() {
  const {
    activeTab,
    dashboardData: { sessions },
  } = useDashboardState();
  const {
    sessions: { onRefreshSessions, onStopSession, onDeleteSession },
  } = useDashboardActions();

  const sorted = [...sessions].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") {
      return -1;
    }
    if (a.status !== "running" && b.status === "running") {
      return 1;
    }
    return b.lastActiveAt - a.lastActiveAt;
  });

  return (
    <TabPanel activeTab={activeTab} className="flex-1" tab="sessions">
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-black font-display text-4xl tracking-tight">
                Sessions
              </h2>
              <div className="mt-4 max-w-md text-justify font-body text-muted text-sm leading-relaxed">
                <span className="float-left mt-1 mr-2 font-black font-display text-5xl text-ink leading-[0.8]">
                  A
                </span>
                ctive and recent chat sessions across all registered projects.
                Monitor real-time interactions and manage the lifecycle of your
                connected AI agents from this central editorial desk. All
                communications are logged for archival purposes.
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-xs">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-2">
                <button className="btn btn-primary min-h-[44px]" type="button">
                  + New Session
                </button>
                <button
                  className="btn btn-secondary min-h-[44px]"
                  onClick={onRefreshSessions}
                  type="button"
                >
                  ↻
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-h-[calc(100dvh-480px)] min-h-[200px] overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <div className="empty-state stagger-item">
              No sessions yet. Start a chat from the UI.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((session, index) => (
                <div className="stagger-item" key={session.id}>
                  <SessionRow
                    onDeleteSession={onDeleteSession}
                    onStopSession={onStopSession}
                    session={session}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </TabPanel>
  );
}
