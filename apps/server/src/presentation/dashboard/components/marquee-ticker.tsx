import { useDashboardState } from "@/presentation/dashboard/dashboard-view.context";
import { formatUptime } from "../utils";

export function MarqueeTicker() {
  const {
    dashboardData: { stats },
  } = useDashboardState();
  const uptime = formatUptime(stats.serverUptime);

  const items = [
    { label: "SERVER STATUS", value: "OPERATIONAL", accent: true },
    { label: "ACTIVE SESSIONS", value: stats.activeSessions },
    { label: "UPTIME", value: uptime },
    { label: "TOTAL PROJECTS", value: stats.totalProjects },
    { label: "EDITION", value: "BETA 1.0" },
    { label: "ENGINE", value: "ERAGEAR" },
    { label: "PROTOCOL", value: "ACP 1.0" },
  ];

  return (
    <div className="relative overflow-hidden border-ink border-b-2 bg-ink py-1 text-paper">
      <div className="flex animate-marquee whitespace-nowrap">
        {/* Repeat twice for seamless loop */}
        {[...items, ...items, ...items].map((item, i) => (
          <div className="flex items-center px-8" key={`${item.label}-${i}`}>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-60">
              {item.label}:
            </span>
            <span
              className={`ml-2 font-mono text-[10px] uppercase tracking-widest ${
                item.accent ? "text-[#CC0000]" : "text-paper"
              }`}
            >
              {item.value}
            </span>
            <span className="ml-8 font-serif text-paper/30 opacity-50">
              &#x2727;
            </span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.33%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        .animate-marquee:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
