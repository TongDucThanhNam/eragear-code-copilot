import type { AgentConfig } from "@/shared/types/agent.types";
import type { DashboardStats } from "../dashboard-data";
import { AgentCard } from "./agent-card";
import { AgentStats } from "./agent-stats";
import { TabPanel } from "./tab-panel";

interface AgentsTabProps {
  agents: AgentConfig[];
  agentStats: DashboardStats["agentStats"];
  activeTab: string;
}

export function AgentsTab({ agents, agentStats, activeTab }: AgentsTabProps) {
  return (
    <TabPanel activeTab={activeTab} scrollable tab="agents">
      <section class="border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-black font-display text-4xl tracking-tight">
                Agent Configs
              </h2>
              <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
                Registered agent presets for spawning sessions
              </p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <span class="border border-ink px-3 py-1 font-mono text-xs">
                {agents.length} agent{agents.length !== 1 ? "s" : ""}
              </span>
              <a class="btn btn-primary min-h-[44px]" href="#add-agent-modal">
                + Add Agent
              </a>
            </div>
          </div>
        </div>

        <div class="min-h-[120px] p-4">
          {agents.length === 0 ? (
            <div class="empty-state">
              No agents configured yet. Add an agent to get started.
            </div>
          ) : (
            agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)
          )}
        </div>
      </section>

      <section class="mt-4 border-2 border-ink bg-paper shadow-news">
        <div class="border-ink border-b-2 p-6">
          <div>
            <h2 class="font-black font-display text-3xl tracking-tight">
              Usage Statistics
            </h2>
            <p class="mt-2 max-w-md font-body text-muted text-sm leading-relaxed">
              Session distribution by agent type
            </p>
          </div>
        </div>

        <div class="min-h-[100px] p-4">
          <AgentStats stats={agentStats} />
        </div>
      </section>
    </TabPanel>
  );
}
