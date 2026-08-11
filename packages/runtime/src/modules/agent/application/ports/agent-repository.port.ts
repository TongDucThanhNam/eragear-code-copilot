import type { SupervisorAgentProfile } from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "#runtime/shared/types/agent.types";

export interface AgentListWithActiveState {
  agents: AgentConfig[];
  activeAgentId: string | null;
}

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
  listSupervisorProfiles?(
    userId: string,
    projectId?: string
  ): Promise<SupervisorAgentProfile[]>;
  saveSupervisorProfile?(
    userId: string,
    profile: SupervisorAgentProfile
  ): Promise<SupervisorAgentProfile>;
  /** Get the currently active agent ID */
  getActiveId(userId: string): Promise<string | null>;
  /** List agents by project */
  listByProject(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]>;
  /** List agents by project and repair missing/dangling active state */
  listByProjectWithActiveState(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentListWithActiveState>;
  /** Create a new agent */
  create(input: AgentInput): Promise<AgentConfig>;
  /** Create a new agent and set it active when active state is missing/invalid */
  createAndEnsureActive(input: AgentInput): Promise<AgentConfig>;
  /** Update an existing agent */
  update(input: AgentUpdateInput): Promise<AgentConfig>;
  /** Delete an agent */
  delete(id: string, userId: string): Promise<void>;
  /** Delete an agent and repair missing/dangling active state */
  deleteAndRepairActive(
    id: string,
    userId: string
  ): Promise<{ activeAgentId: string | null }>;
  /** Set the active agent */
  setActive(id: string | null, userId: string): Promise<void>;
  /** Ensure default agents exist atomically and return active agent state */
  ensureDefaultsSeeded(
    userId: string,
    defaultAgentInput: AgentInput
  ): Promise<{ activeAgentId: string | null }>;
}
