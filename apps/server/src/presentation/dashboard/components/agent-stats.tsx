import type { DashboardStats } from "@/presentation/dashboard/dashboard-data";

interface AgentStatsProps {
  stats: DashboardStats["agentStats"];
}

export function AgentStats({ stats }: AgentStatsProps) {
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    return <div className="empty-state">No agent usage data yet.</div>;
  }

  return (
    <>
      {entries.map(([name, stat]) => (
        <div
          className="card mb-2"
          key={name}
          style={{ marginBottom: "0.5rem" }}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">{name}</span>
            <span className="font-mono text-xs">
              <span className="text-success">{stat.running} running</span>
              <span className="ml-4 text-muted">{stat.count} total</span>
            </span>
          </div>
        </div>
      ))}
    </>
  );
}
