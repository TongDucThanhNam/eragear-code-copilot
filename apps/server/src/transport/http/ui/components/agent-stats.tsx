import type { DashboardStats } from "@/transport/http/ui/dashboard-data";

interface AgentStatsProps {
  stats: DashboardStats["agentStats"];
}

export function AgentStats({ stats }: AgentStatsProps) {
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    return <div class="empty-state">No agent usage data yet.</div>;
  }

  return (
    <>
      {entries.map(([name, stat]) => (
        <div class="card mb-2" key={name} style={{ marginBottom: "0.5rem" }}>
          <div class="flex items-center justify-between">
            <span class="font-semibold">{name}</span>
            <span class="font-mono text-xs">
              <span class="text-success">{stat.running} running</span>
              <span class="ml-4 text-muted">{stat.count} total</span>
            </span>
          </div>
        </div>
      ))}
    </>
  );
}
