import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";
import { formatUptime } from "../utils";

export function OverviewStats() {
  const {
    dashboardData: { stats },
  } = useDashboardState();

  return (
    <section className="overview-panel group">
      {/* Section Header */}
      <div className="overview-kicker">
        <span className="overview-kicker-line" />
        <span className="overview-kicker-text">At a Glance</span>
        <span className="overview-kicker-line" />
      </div>

      <h2 className="overview-title">Overview</h2>

      {/* Stats Grid */}
      <div className="overview-grid">
        <div className="overview-cell group/cell hover:bg-paper transition-colors duration-200">
          <div className="overview-value group-hover/cell:scale-110 transition-transform duration-200">
            {stats.totalProjects || 0}
          </div>
          <div className="overview-label">Projects</div>
        </div>
        <div className="overview-cell group/cell hover:bg-paper transition-colors duration-200">
          <div className="overview-value group-hover/cell:scale-110 transition-transform duration-200">
            {stats.totalSessions || 0}
          </div>
          <div className="overview-label">Sessions</div>
        </div>
        <div className="overview-cell overview-cell-active group/cell">
          <div className="overview-value group-hover/cell:scale-110 transition-transform duration-200">
            {stats.activeSessions || 0}
          </div>
          <div className="overview-label">Active Now</div>
        </div>
        <div className="overview-cell group/cell hover:bg-paper transition-colors duration-200">
          <div className="overview-value group-hover/cell:scale-110 transition-transform duration-200">
            {stats.recentSessions24h || 0}
          </div>
          <div className="overview-label">Last 24h</div>
        </div>
        <div className="overview-cell overview-cell-uptime group/cell">
          <div className="overview-value overview-value-uptime group-hover/cell:scale-105 transition-transform duration-200">
            {formatUptime(stats.serverUptime)}
          </div>
          <div className="overview-label">Server Uptime</div>
        </div>
      </div>

      {/* Decorative Divider */}
      <div className="overview-divider">✦ ✦ ✦</div>

      {/* Weekly Stats */}
      <div className="overview-weekly">
        <p className="overview-label">This Week</p>
        <p className="overview-weekly-value group-hover:scale-105 transition-transform duration-200">
          {stats.weeklySessions || 0}
        </p>
        <p className="overview-label">Sessions Completed</p>
      </div>

      <style>{`
        /* Enhanced panel animations */
        .overview-panel {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .overview-panel:hover {
          box-shadow: 6px 6px 0 0 var(--ink);
        }

        /* Cell hover effects */
        .overview-cell {
          transition: all 0.2s ease;
        }

        .overview-cell:hover {
          transform: translate(-2px, -2px);
          box-shadow: 2px 2px 0 0 var(--ink);
        }

        /* Value counter animation */
        .overview-value {
          transition: transform 0.2s ease;
        }

        /* Active pulse effect */
        .overview-cell-active .overview-value {
          animation: activePulse 2s ease-in-out infinite;
        }

        @keyframes activePulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.8;
          }
        }

        /* Decorative divider animation */
        .overview-divider {
          position: relative;
          overflow: hidden;
        }

        .overview-divider::before {
          content: '';
          position: absolute;
          top: 50%;
          left: -50%;
          width: 50%;
          height: 1px;
          background: linear-gradient(
            to right,
            transparent,
            var(--ink-subtle),
            transparent
          );
          animation: shimmer 3s ease-in-out infinite;
        }

        @keyframes shimmer {
          0% {
            left: -50%;
          }
          100% {
            left: 150%;
          }
        }

        /* Weekly value enhancement */
        .overview-weekly-value {
          position: relative;
          display: inline-block;
        }

        .overview-weekly-value::after {
          content: '';
          position: absolute;
          bottom: -2px;
          left: 0;
          width: 100%;
          height: 2px;
          background: var(--ink);
          transform: scaleX(0);
          transform-origin: right;
          transition: transform 0.3s ease;
        }

        .overview-weekly:hover .overview-weekly-value::after {
          transform: scaleX(1);
          transform-origin: left;
        }

        /* Responsive improvements */
        @media (max-width: 1023px) {
          .overview-panel {
            position: static !important;
          }
        }

        /* Print styles */
        @media print {
          .overview-panel {
            box-shadow: none !important;
            border: 2px solid var(--ink) !important;
          }

          .overview-cell:hover {
            transform: none !important;
            box-shadow: none !important;
          }
        }

        /* Reduce motion support */
        @media (prefers-reduced-motion: reduce) {
          .overview-value,
          .overview-cell,
          .overview-weekly-value,
          .overview-panel {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </section>
  );
}
