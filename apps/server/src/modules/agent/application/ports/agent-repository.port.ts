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
  findById(id: string): AgentConfig | undefined;
  /** Find all agents */
  findAll(): AgentConfig[];
  /** Get the currently active agent ID */
  getActiveId(): string | null;
  /** List agents by project */
  listByProject(projectId?: string | null): AgentConfig[];
  /** Create a new agent */
  create(input: AgentInput): AgentConfig;
  /** Update an existing agent */
  update(input: AgentUpdateInput): AgentConfig;
  /** Delete an agent */
  delete(id: string): void;
  /** Set the active agent */
  setActive(id: string | null): void;
}
