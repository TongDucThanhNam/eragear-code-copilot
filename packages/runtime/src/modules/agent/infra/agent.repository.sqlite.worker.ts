import { callSqliteWorker } from "#runtime/platform/storage/sqlite-worker-client";
import type { SupervisorAgentProfile } from "#runtime/shared/contracts/supervisor-agent-profile.contract";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "#runtime/shared/types/agent.types";
import type { AgentRepositoryPort } from "../application/ports/agent-repository.port";

export class AgentSqliteWorkerRepository implements AgentRepositoryPort {
  findById(id: string, userId: string): Promise<AgentConfig | undefined> {
    return callSqliteWorker("agent", "findById", [id, userId]);
  }

  findAll(userId: string): Promise<AgentConfig[]> {
    return callSqliteWorker("agent", "findAll", [userId]);
  }

  listSupervisorProfiles(
    userId: string,
    projectId?: string
  ): Promise<SupervisorAgentProfile[]> {
    return callSqliteWorker("agent", "listSupervisorProfiles", [
      userId,
      projectId,
    ]);
  }

  saveSupervisorProfile(
    userId: string,
    profile: SupervisorAgentProfile
  ): Promise<SupervisorAgentProfile> {
    return callSqliteWorker("agent", "saveSupervisorProfile", [
      userId,
      profile,
    ]);
  }

  getActiveId(userId: string): Promise<string | null> {
    return callSqliteWorker("agent", "getActiveId", [userId]);
  }

  listByProject(
    projectId: string | null | undefined,
    userId: string
  ): Promise<AgentConfig[]> {
    return callSqliteWorker("agent", "listByProject", [projectId, userId]);
  }

  listByProjectWithActiveState(
    projectId: string | null | undefined,
    userId: string
  ): Promise<{ agents: AgentConfig[]; activeAgentId: string | null }> {
    return callSqliteWorker("agent", "listByProjectWithActiveState", [
      projectId,
      userId,
    ]);
  }

  create(input: AgentInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "create", [input]);
  }

  createAndEnsureActive(input: AgentInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "createAndEnsureActive", [input]);
  }

  update(input: AgentUpdateInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "update", [input]);
  }

  delete(id: string, userId: string): Promise<void> {
    return callSqliteWorker("agent", "delete", [id, userId]);
  }

  deleteAndRepairActive(
    id: string,
    userId: string
  ): Promise<{ activeAgentId: string | null }> {
    return callSqliteWorker("agent", "deleteAndRepairActive", [id, userId]);
  }

  setActive(id: string | null, userId: string): Promise<void> {
    return callSqliteWorker("agent", "setActive", [id, userId]);
  }

  ensureDefaultsSeeded(
    userId: string,
    defaultAgentInput: AgentInput
  ): Promise<{ activeAgentId: string | null }> {
    return callSqliteWorker("agent", "ensureDefaultsSeeded", [
      userId,
      defaultAgentInput,
    ]);
  }
}
