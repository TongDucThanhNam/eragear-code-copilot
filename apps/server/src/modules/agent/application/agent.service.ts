/**
 * Agent Service
 *
 * Application service for managing agent lifecycle and operations.
 * Orchestrates agent repository operations for CRUD and state management.
 *
 * @module modules/agent/application/agent.service
 */

import type {
  AgentInput,
  AgentUpdateInput,
} from "../../../shared/types/agent.types";
import type { AgentRepositoryPort } from "../../../shared/types/ports";

export class AgentService {
  /** Repository for agent persistence operations */
  private readonly agentRepo: AgentRepositoryPort;

  /**
   * Creates an AgentService with the given repository
   * @param agentRepo - The agent repository implementation
   */
  constructor(agentRepo: AgentRepositoryPort) {
    this.agentRepo = agentRepo;
  }

  /**
   * Lists all agents, optionally filtered by project
   *
   * @param projectId - Optional project ID to filter agents by
   * @returns Array of agent configurations
   */
  listAgents(projectId?: string | null) {
    return {
      agents: this.agentRepo.listByProject(projectId),
      activeAgentId: this.agentRepo.getActiveId(),
    };
  }

  /**
   * Creates a new agent
   *
   * @param input - Agent creation input
   * @returns The created agent configuration
   */
  createAgent(input: AgentInput) {
    return this.agentRepo.create(input);
  }

  /**
   * Updates an existing agent
   *
   * @param input - Agent update input containing id and fields to update
   * @returns The updated agent configuration
   */
  updateAgent(input: AgentUpdateInput) {
    return this.agentRepo.update(input);
  }

  /**
   * Deletes an agent by ID
   *
   * @param id - The agent ID to delete
   * @returns Success status object
   */
  deleteAgent(id: string) {
    this.agentRepo.delete(id);
    return { success: true };
  }

  /**
   * Sets the active agent
   *
   * @param id - The agent ID to set as active, or null to deactivate
   * @returns The updated active agent ID
   */
  setActive(id: string | null) {
    return this.agentRepo.setActive(id);
  }
}
