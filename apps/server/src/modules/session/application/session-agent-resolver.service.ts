import type { AgentRepositoryPort } from "@/modules/agent";
import { NotFoundError } from "@/shared/errors";
import type { AgentConfig } from "@/shared/types/agent.types";

const OP = "session.lifecycle.resolve_agent";

export interface SessionAgentResolverInput {
  userId: string;
  projectId?: string;
  agentId?: string;
}

export interface SessionAgentRuntimeConfig {
  agentId: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class SessionAgentResolverService {
  private readonly agentRepo: AgentRepositoryPort;

  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  async resolve(
    input: SessionAgentResolverInput
  ): Promise<SessionAgentRuntimeConfig> {
    if (input.agentId) {
      const requestedAgent = await this.agentRepo.findById(
        input.agentId,
        input.userId
      );
      if (!requestedAgent) {
        throw new NotFoundError("Agent not found", {
          module: "session",
          op: OP,
          details: {
            agentId: input.agentId,
          },
        });
      }
      return this.toRuntimeConfig(requestedAgent);
    }

    const activeAgentId = await this.agentRepo.getActiveId(input.userId);
    if (activeAgentId) {
      const activeAgent = await this.agentRepo.findById(activeAgentId, input.userId);
      if (
        activeAgent &&
        this.isProjectCompatible(activeAgent, input.projectId)
      ) {
        return this.toRuntimeConfig(activeAgent);
      }
    }

    const fallbackAgents = await this.agentRepo.listByProject(
      input.projectId,
      input.userId
    );
    const selectedAgent = fallbackAgents[0];
    if (!selectedAgent) {
      throw new NotFoundError("No agent available for session", {
        module: "session",
        op: OP,
        details: {
          projectId: input.projectId,
        },
      });
    }
    return this.toRuntimeConfig(selectedAgent);
  }

  private isProjectCompatible(
    agent: AgentConfig,
    projectId: string | undefined
  ): boolean {
    if (!projectId) {
      return true;
    }
    if (!agent.projectId) {
      return true;
    }
    return agent.projectId === projectId;
  }

  private toRuntimeConfig(agent: AgentConfig): SessionAgentRuntimeConfig {
    return {
      agentId: agent.id,
      command: agent.command,
      args: agent.args,
      env: agent.env,
    };
  }
}
