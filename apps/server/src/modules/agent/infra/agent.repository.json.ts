/**
 * Agent JSON Repository
 *
 * JSON-backed implementation of the AgentRepositoryPort.
 * Persists agent configurations to a local JSON file in `.eragear` directory.
 *
 * @module modules/agent/infra/agent.repository.json
 */

import { readJsonFile, writeJsonFile } from "../../../infra/storage/json-store";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "../../../shared/types/agent.types";
import type { AgentRepositoryPort } from "../../../shared/types/ports";

/** Storage file name for agents data */
const AGENTS_FILE = "agents.json";

/**
 * JSON repository for agent persistence
 * Implements AgentRepositoryPort using local JSON file storage
 */
export class AgentJsonRepository implements AgentRepositoryPort {
  /**
   * Retrieves all agents data including active agent ID
   * @returns Object containing agents array and active agent ID
   */
  private getAgentsData(): {
    agents: AgentConfig[];
    activeAgentId: string | null;
  } {
    const fallback = {
      agents: [
        {
          id: "default-opencode",
          name: "Default (Opencode)",
          type: "opencode" as const,
          command: "opencode",
          args: ["acp"],
          env: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      activeAgentId: "default-opencode",
    };
    return readJsonFile(AGENTS_FILE, fallback);
  }

  /**
   * Persists agents data to JSON file
   * @param data - Object containing agents array and active agent ID
   */
  private saveAgentsData(data: {
    agents: AgentConfig[];
    activeAgentId: string | null;
  }): void {
    writeJsonFile(AGENTS_FILE, data);
  }

  /**
   * Finds an agent by ID
   * @param id - Agent ID to find
   * @returns Agent configuration or undefined if not found
   */
  findById(id: string): AgentConfig | undefined {
    const data = this.getAgentsData();
    return data.agents.find((a) => a.id === id);
  }

  /**
   * Retrieves all agents
   * @returns Array of all agent configurations
   */
  findAll(): AgentConfig[] {
    const data = this.getAgentsData();
    return data.agents;
  }

  /**
   * Gets the active agent ID
   * @returns Active agent ID or null if none is set
   */
  getActiveId(): string | null {
    const data = this.getAgentsData();
    return data.activeAgentId;
  }

  /**
   * Lists agents filtered by project
   * @param projectId - Optional project ID to filter by (undefined returns all)
   * @returns Array of agent configurations
   */
  listByProject(projectId?: string | null): AgentConfig[] {
    const data = this.getAgentsData();
    if (projectId === undefined) {
      return data.agents;
    }
    return data.agents.filter((a) => !a.projectId || a.projectId === projectId);
  }

  /**
   * Creates a new agent
   *
   * @param input - Agent creation input
   * @returns The created agent configuration
   * @throws Error if agent name is empty
   */
  create(input: AgentInput): AgentConfig {
    const data = this.getAgentsData();
    const name = input.name.trim();

    if (!name) {
      throw new Error("Agent name is required");
    }

    const now = Date.now();
    const newAgent: AgentConfig = {
      id: crypto.randomUUID?.() || `agent-${Date.now()}`,
      name,
      type: input.type,
      command: input.command,
      args: input.args,
      env: input.env,
      projectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    };

    data.agents.push(newAgent);

    if (!data.activeAgentId) {
      data.activeAgentId = newAgent.id;
    }

    this.saveAgentsData(data);
    return newAgent;
  }

  /**
   * Updates an existing agent
   *
   * @param input - Agent update input containing ID and fields to update
   * @returns The updated agent configuration
   * @throws Error if agent is not found
   */
  update(input: AgentUpdateInput): AgentConfig {
    const data = this.getAgentsData();
    const index = data.agents.findIndex((a) => a.id === input.id);

    if (index === -1) {
      throw new Error("Agent not found");
    }

    const current = data.agents[index];
    if (!current) {
      throw new Error("Agent not found");
    }

    const updated: AgentConfig = {
      ...current,
      name: input.name?.trim() || current.name,
      type: input.type || current.type,
      command: input.command || current.command,
      args: input.args !== undefined ? input.args : current.args,
      env: input.env !== undefined ? input.env : current.env,
      updatedAt: Date.now(),
    };

    data.agents[index] = updated;
    this.saveAgentsData(data);
    return updated;
  }

  /**
   * Deletes an agent by ID
   * Also updates active agent if the deleted agent was active
   *
   * @param id - Agent ID to delete
   */
  delete(id: string): void {
    const data = this.getAgentsData();
    const newAgents = data.agents.filter((a) => a.id !== id);

    let newActiveId = data.activeAgentId;
    if (data.activeAgentId === id) {
      newActiveId = newAgents[0]?.id ?? null;
    }

    this.saveAgentsData({
      agents: newAgents,
      activeAgentId: newActiveId,
    });
  }

  /**
   * Sets the active agent
   *
   * @param id - Agent ID to set as active, or null to deactivate
   * @throws Error if the specified agent doesn't exist
   */
  setActive(id: string | null): void {
    const data = this.getAgentsData();
    if (id) {
      const exists = data.agents.some((a) => a.id === id);
      if (!exists) {
        throw new Error("Agent not found");
      }
    }

    data.activeAgentId = id;
    this.saveAgentsData(data);
  }
}
