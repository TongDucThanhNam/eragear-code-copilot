import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";

/**
 * Port for agent data persistence operations.
 */
export interface AgentRepositoryPort {
  /** Find an agent by ID */
  findById(id: string, userId: string): Promise<AgentConfig | undefined>;
  /** Find all agents */
  findAll(userId: string): Promise<AgentConfig[]>;
  /** Get the currently active agent ID */
  getActiveId(userId: string): Promise<string | null>;
  /** List agents by project */
  listByProject(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]>;
  /** Create a new agent */
  create(input: AgentInput): Promise<AgentConfig>;
  /** Update an existing agent */
  update(input: AgentUpdateInput): Promise<AgentConfig>;
  /** Delete an agent */
  delete(id: string, userId: string): Promise<void>;
  /** Set the active agent */
  setActive(id: string | null, userId: string): Promise<void>;
}
