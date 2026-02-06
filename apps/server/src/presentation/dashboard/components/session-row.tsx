import type { SessionSummary } from "@/presentation/dashboard/dashboard-data";
import { formatTimeAgo } from "../utils";

interface SessionRowProps {
  session: SessionSummary;
  onStopSession: (chatId: string) => void;
  onDeleteSession: (chatId: string) => void;
}

export function SessionRow({
  session,
  onStopSession,
  onDeleteSession,
}: SessionRowProps) {
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
        <span className="session-time">
          {formatTimeAgo(session.lastActiveAt)}
        </span>
        <span className={`badge ${badgeClass}`}>{session.status}</span>
        <div className="session-actions">
          <button
            className="session-action-btn stop"
            disabled={!canStop}
            onClick={() => onStopSession(session.id)}
            type="button"
          >
            Stop
          </button>
          <button
            className="session-action-btn delete"
            onClick={() => onDeleteSession(session.id)}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
