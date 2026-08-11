import type { AgentUseCases } from "#runtime/modules/use-cases";
import type { SupervisorPlannerAgent } from "../application/contracts/supervisor-planner.contract";
import type { SupervisorAgentCatalogPort } from "../application/ports/supervisor-orchestrator.port";
import type { SupervisorAgentProfileService } from "../application/supervisor-agent-profile.service";

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
  private readonly profiles?: Pick<SupervisorAgentProfileService, "list">;

  constructor(
    agents: AgentUseCases["list"],
    profiles?: Pick<SupervisorAgentProfileService, "list">
  ) {
    this.agents = agents;
    this.profiles = profiles;
  }

  async listEligible(input: {
    userId: string;
    projectId?: string;
  }): Promise<SupervisorPlannerAgent[]> {
    const result = await this.agents.execute(
      input.userId,
      input.projectId ?? null
    );
    const configuredProfiles = this.profiles
      ? await this.profiles.list(input)
      : [];
    const profiles = new Map(
      configuredProfiles.map((profile) => [profile.agentId, profile])
    );
    return result.agents
      .map((agent) => {
        const profile = profiles.get(agent.id);
        const workerRoles = profile?.roles.filter(
          (role): role is (typeof ALL_WORKER_ROLES)[number] =>
            role !== "manager"
        );
        return {
          agentId: agent.id,
          displayName: agent.name,
          active: profile?.enabled ?? true,
          managerEligible: profile?.roles.includes("manager") ?? true,
          overnightEligible: profile
            ? profile.readiness.handshake === "passed" &&
              profile.readiness.exactResume === "passed"
            : undefined,
          roles:
            workerRoles && workerRoles.length > 0
              ? workerRoles
              : [...ALL_WORKER_ROLES],
        };
      })
      .filter((agent) => agent.active);
  }
}
