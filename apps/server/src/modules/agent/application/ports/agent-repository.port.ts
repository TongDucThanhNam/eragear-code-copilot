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
  findById(id: string): Promise<AgentConfig | undefined>;
  /** Find all agents */
  findAll(): Promise<AgentConfig[]>;
  /** Get the currently active agent ID */
  getActiveId(): Promise<string | null>;
  /** List agents by project */
  listByProject(projectId?: string | null): Promise<AgentConfig[]>;
  /** Create a new agent */
  create(input: AgentInput): Promise<AgentConfig>;
  /** Update an existing agent */
  update(input: AgentUpdateInput): Promise<AgentConfig>;
  /** Delete an agent */
  delete(id: string): Promise<void>;
  /** Set the active agent */
  setActive(id: string | null): Promise<void>;
}
