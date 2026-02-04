import type { AgentConfig } from "@/shared/types/agent.types";
import type { DashboardStats } from "../dashboard-data";
import { AgentCard } from "./agent-card";
import { AgentStats } from "./agent-stats";
import { TabPanel } from "./tab-panel";

interface AgentsTabProps {
  agents: AgentConfig[];
  agentStats: DashboardStats["agentStats"];
  activeTab: string;
  onDeleteAgent: (agentId: string) => void;
}

export function AgentsTab({
  agents,
  agentStats,
  activeTab,
  onDeleteAgent,
}: AgentsTabProps) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="agents">
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-black font-display text-4xl tracking-tight">
                Agent Configs
              </h2>
              <p className="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Registered agent presets for spawning sessions
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-xs">
                {agents.length} agent{agents.length !== 1 ? "s" : ""}
              </span>
              <a className="btn btn-primary min-h-[44px]" href="#add-agent-modal">
                + Add Agent
              </a>
            </div>
          </div>
        </div>

        <div className="min-h-[120px] p-4">
          {agents.length === 0 ? (
            <div className="empty-state">
              No agents configured yet. Add an agent to get started.
            </div>
          ) : (
            agents.map((agent) => (
              <AgentCard
                agent={agent}
                key={agent.id}
                onDeleteAgent={onDeleteAgent}
              />
            ))
          )}
        </div>
      </section>

      <section className="mt-4 border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div>
            <h2 className="font-black font-display text-3xl tracking-tight">
              Usage Statistics
            </h2>
            <p className="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
              Session distribution by agent type
            </p>
          </div>
        </div>

        <div className="min-h-[100px] p-4">
          <AgentStats stats={agentStats} />
        </div>
      </section>
    </TabPanel>
  );
}
