import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";
import { formatUptime } from "../utils";

export function OverviewStats() {
  const {
    dashboardData: { stats },
  } = useDashboardState();

  return (
    <section className="overview-panel">
      <div className="overview-kicker">
        <span className="overview-kicker-line" />
        <span className="overview-kicker-text">At a Glance</span>
        <span className="overview-kicker-line" />
      </div>

      <h2 className="overview-title">Overview</h2>

      <div className="overview-grid">
        <div className="overview-cell">
          <div className="overview-value">{stats.totalProjects || 0}</div>
          <div className="overview-label">Projects</div>
        </div>
        <div className="overview-cell">
          <div className="overview-value">{stats.totalSessions || 0}</div>
          <div className="overview-label">Sessions</div>
        </div>
        <div className="overview-cell overview-cell-active">
          <div className="overview-value">{stats.activeSessions || 0}</div>
          <div className="overview-label">Active Now</div>
        </div>
        <div className="overview-cell">
          <div className="overview-value">{stats.recentSessions24h || 0}</div>
          <div className="overview-label">Last 24h</div>
        </div>
        <div className="overview-cell overview-cell-uptime">
          <div className="overview-value overview-value-uptime">
            {formatUptime(stats.serverUptime)}
          </div>
          <div className="overview-label">Server Uptime</div>
        </div>
      </div>

      <div className="overview-divider">* * *</div>

      <div className="overview-weekly">
        <p className="overview-label">This Week</p>
        <p className="overview-weekly-value">{stats.weeklySessions || 0}</p>
        <p className="overview-label">Sessions Completed</p>
      </div>
    </section>
  );
}
