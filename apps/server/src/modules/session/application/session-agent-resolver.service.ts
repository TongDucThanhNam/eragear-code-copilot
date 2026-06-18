import type { AgentRepositoryPort } from "@/modules/agent";
import { NotFoundError } from "@/shared/errors";
import type { AgentConfig } from "@/shared/types/agent.types";

const OP = "session.lifecycle.resolve_agent";

/**
 * Agent selection request for session startup or discovery.
 *
 * Caller contract: explicit `agentId` wins; otherwise the active user agent is
 * used only when compatible with the requested project.
 */
export interface SessionAgentResolverInput {
  userId: string;
  projectId?: string;
  agentId?: string;
}

/**
 * Runtime-safe subset of an agent config needed to spawn an ACP process.
 *
 * Invariant: repository ownership checks have already been applied for `agentId`.
 */
export interface SessionAgentRuntimeConfig {
  agentId: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Resolves the concrete agent command for a session lifecycle operation.
 *
 * Error mode: throws `NotFoundError` when the requested agent is missing or no
 * project-compatible fallback agent exists for the user.
 */
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

    const { agents, activeAgentId } =
      await this.agentRepo.listByProjectWithActiveState(
        input.projectId,
        input.userId
      );
    const selectedAgent = activeAgentId
      ? (agents.find((agent) => agent.id === activeAgentId) ?? agents[0])
      : agents[0];
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

  private toRuntimeConfig(agent: AgentConfig): SessionAgentRuntimeConfig {
    return {
      agentId: agent.id,
      command: agent.command,
      args: agent.args,
      env: agent.env,
    };
  }
}
