import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";

/**
 * Agent configuration persistence port scoped by user.
 *
 * Invariant: all reads and writes that accept `userId` must enforce ownership;
 * `ensureDefaultsSeeded` must be atomic so concurrent bootstraps do not create
 * duplicate default agents.
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
  /** Ensure default agents exist atomically and return active agent state */
  ensureDefaultsSeeded(
    userId: string,
    defaultAgentInput: AgentInput
  ): Promise<{ activeAgentId: string | null }>;
}
