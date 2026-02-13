import {
  useDashboardActions,
  useDashboardState,
} from "@/presentation/dashboard/dashboard-view.context";
import { AgentCard } from "./agent-card";
import { AgentStats } from "./agent-stats";
import { TabPanel } from "./tab-panel";

export function AgentsTab() {
  const {
    activeTab,
    dashboardData: {
      agents,
      stats: { agentStats },
    },
  } = useDashboardState();
  const {
    agents: { onDeleteAgent },
  } = useDashboardActions();

  return (
    <TabPanel activeTab={activeTab} scrollable tab="agents">
      <section className="border-2 border-ink bg-paper shadow-news">
        <div className="border-ink border-b-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-black font-display text-4xl tracking-tight">
                Agent Configs
              </h2>
              <div className="mt-4 max-w-md text-justify font-body text-muted text-sm leading-relaxed">
                <span className="float-left mt-1 mr-2 font-black font-display text-5xl text-ink leading-[0.8]">
                  R
                </span>
                egistered agent presets for spawning sessions. These
                configurations define the behavior and capabilities of your AI
                operatives, allowing for consistent and repeatable interactions
                across various projects and session types.
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="border border-ink px-3 py-1 font-mono text-xs">
                {agents.length} agent{agents.length !== 1 ? "s" : ""}
              </span>
              <a
                className="btn btn-primary min-h-[44px]"
                href="#add-agent-modal"
              >
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
            <div className="mt-4 max-w-md text-justify font-body text-muted text-sm leading-relaxed">
              <span className="float-left mt-1 mr-2 font-black font-display text-5xl text-ink leading-[0.8]">
                S
              </span>
              ession distribution by agent type. This report provides insights
              into which agent configurations are most utilized within your
              environment, helping you optimize resource allocation and agent
              specialization strategies.
            </div>
          </div>
        </div>

        <div className="min-h-[100px] p-4">
          <AgentStats stats={agentStats} />
        </div>
      </section>
    </TabPanel>
  );
}
