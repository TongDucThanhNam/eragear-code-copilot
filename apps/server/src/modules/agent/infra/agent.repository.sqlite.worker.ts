import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import type { AgentRepositoryPort } from "../application/ports/agent-repository.port";

export class AgentSqliteWorkerRepository implements AgentRepositoryPort {
  findById(id: string, userId: string): Promise<AgentConfig | undefined> {
    return callSqliteWorker("agent", "findById", [id, userId]);
  }

  findAll(userId: string): Promise<AgentConfig[]> {
    return callSqliteWorker("agent", "findAll", [userId]);
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

  create(input: AgentInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "create", [input]);
  }

  update(input: AgentUpdateInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "update", [input]);
  }

  delete(id: string, userId: string): Promise<void> {
    return callSqliteWorker("agent", "delete", [id, userId]);
  }

  setActive(id: string | null, userId: string): Promise<void> {
    return callSqliteWorker("agent", "setActive", [id, userId]);
  }
}
