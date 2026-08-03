import type { AgentUseCases } from "#runtime/modules/use-cases";
import type { SupervisorPlannerAgent } from "../application/contracts/supervisor-planner.contract";
import type { SupervisorAgentCatalogPort } from "../application/ports/supervisor-orchestrator.port";

const ALL_WORKER_ROLES: SupervisorPlannerAgent["roles"] = [
  "research",
  "implementation",
  "test",
  "review",
  "integration",
];

export class ConfiguredAgentCatalogAdapter
  implements SupervisorAgentCatalogPort
{
  private readonly agents: AgentUseCases["list"];

  constructor(agents: AgentUseCases["list"]) {
    this.agents = agents;
  }

  async listEligible(input: {
    userId: string;
    projectId?: string;
  }): Promise<SupervisorPlannerAgent[]> {
    const result = await this.agents.execute(
      input.userId,
      input.projectId ?? null
    );
    return result.agents.map((agent) => ({
      agentId: agent.id,
      displayName: agent.name,
      // Agent records do not have an enabled flag. Presence in the user-owned,
      // project-compatible configuration list is the eligibility boundary;
      // activeAgentId remains only the UI/default selection.
      active: true,
      roles: [...ALL_WORKER_ROLES],
    }));
  }
}
