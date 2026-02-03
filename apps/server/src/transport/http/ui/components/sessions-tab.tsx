import type { SessionSummary } from "@/transport/http/ui/dashboard-data";
import { SessionRow } from "./session-row";
import { TabPanel } from "./tab-panel";

interface SessionsTabProps {
  sessions: SessionSummary[];
  activeTab: string;
}

export function SessionsTab({ sessions, activeTab }: SessionsTabProps) {
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
              <p className="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Active and recent chat sessions across all registered projects
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-xs">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-2">
                <button className="btn btn-primary min-h-[44px]" type="button">
                  + New Session
                </button>
                <a className="btn btn-secondary min-h-[44px]" href="/?tab=sessions">
                  ↻
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="max-h-[calc(100dvh-480px)] min-h-[200px] overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <div className="empty-state">
              No sessions yet. Start a chat from the UI.
            </div>
          ) : (
            sorted.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))
          )}
        </div>
      </section>
    </TabPanel>
  );
}
