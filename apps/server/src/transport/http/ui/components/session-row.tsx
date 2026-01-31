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
    <div class={`session-item ${session.isActive ? "active" : ""}`}>
      <div class="session-info flex items-center">
        <span class={`status-dot ${statusClass}`} />
        <div>
          <div class="session-project truncate">
            {session.projectName || "Unknown"}
          </div>
          <div class="session-agent">
            {session.agentName}
            {session.modeId ? ` / ${session.modeId}` : ""}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="session-time">{formatTimeAgo(session.lastActiveAt)}</span>
        <span class={`badge ${badgeClass}`}>{session.status}</span>
        <div class="session-actions">
          <form action="/form/sessions/stop" method="post">
            <input name="chatId" type="hidden" value={session.id} />
            <button
              class="session-action-btn stop"
              disabled={!canStop}
              type="submit"
            >
              Stop
            </button>
          </form>
          <form action="/form/sessions/delete" method="post">
            <input name="chatId" type="hidden" value={session.id} />
            <button class="session-action-btn delete" type="submit">
              Delete
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
