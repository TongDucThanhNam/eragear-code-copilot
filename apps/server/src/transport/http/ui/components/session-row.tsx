import type { SessionSummary } from "@/transport/http/ui/dashboard-data";
import { formatTimeAgo } from "../utils";

interface SessionRowProps {
  session: SessionSummary;
}

export function SessionRow({ session }: SessionRowProps) {
  const canStop = session.isActive || session.status === "running";
  const isRunning = session.status === "running";
  const statusClass = isRunning ? "running" : "stopped";
  const badgeClass = isRunning ? "badge-success" : "badge-warning";

  return (
    <div className={`session-item ${session.isActive ? "active" : ""}`}>
      <div className="session-info flex items-center">
        <span className={`status-dot ${statusClass}`} />
        <div>
          <div className="session-project truncate">
            {session.projectName || "Unknown"}
          </div>
          <div className="session-agent">
            {session.agentName}
            {session.modeId ? ` / ${session.modeId}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="session-time">{formatTimeAgo(session.lastActiveAt)}</span>
        <span className={`badge ${badgeClass}`}>{session.status}</span>
        <div className="session-actions">
          <form action="/form/sessions/stop" method="post">
            <input name="chatId" type="hidden" value={session.id} />
            <button
              className="session-action-btn stop"
              disabled={!canStop}
              type="submit"
            >
              Stop
            </button>
          </form>
          <form action="/form/sessions/delete" method="post">
            <input name="chatId" type="hidden" value={session.id} />
            <button className="session-action-btn delete" type="submit">
              Delete
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
