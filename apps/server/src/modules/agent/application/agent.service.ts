/**
 * Agent Service
 *
 * Application service for managing agent lifecycle and operations.
 * Orchestrates agent repository operations for CRUD and state management.
 *
 * @module modules/agent/application/agent.service
 */

import { ValidationError } from "../../../shared/errors";
import type {
  AgentInput,
  AgentUpdateInput,
} from "../../../shared/types/agent.types";
import { parseCommandInput } from "../../../shared/utils/cli-args.util";
import type { AgentRepositoryPort } from "./ports/agent-repository.port";

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
    const normalized = this.normalizeAgentInput(input);
    return this.agentRepo.create(normalized);
  }

  /**
   * Updates an existing agent
   *
   * @param input - Agent update input containing id and fields to update
   * @returns The updated agent configuration
   */
  updateAgent(input: AgentUpdateInput) {
    const normalized = this.normalizeAgentUpdateInput(input);
    return this.agentRepo.update(normalized);
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

  private normalizeAgentInput(input: AgentInput): AgentInput {
    const normalized = this.normalizeCommandAndArgs(input.command, input.args);
    return {
      ...input,
      command: normalized.command,
      args: normalized.args,
    };
  }

  private normalizeAgentUpdateInput(input: AgentUpdateInput): AgentUpdateInput {
    if (!input.command) {
      return input;
    }
    const normalized = this.normalizeCommandAndArgs(input.command, input.args);
    return {
      ...input,
      command: normalized.command,
      args: normalized.args,
    };
  }

  private normalizeCommandAndArgs(command: string, args?: string[]) {
    const parsed = parseCommandInput(command);
    if (parsed.error || !parsed.command) {
      throw new ValidationError(parsed.error ?? "Command is required.");
    }
    const mergedArgs = [...(parsed.args ?? [])];
    if (args !== undefined) {
      mergedArgs.push(...args);
    }
    return {
      command: parsed.command,
      args:
        mergedArgs.length > 0 || args !== undefined ? mergedArgs : undefined,
    };
  }
}
