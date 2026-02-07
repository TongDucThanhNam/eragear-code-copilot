import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type {
  AgentConfig,
  AgentInput,
  AgentUpdateInput,
} from "@/shared/types/agent.types";
import type { AgentRepositoryPort } from "../application/ports/agent-repository.port";

export class AgentSqliteWorkerRepository implements AgentRepositoryPort {
  findById(id: string): Promise<AgentConfig | undefined> {
    return callSqliteWorker("agent", "findById", [id]);
  }

  findAll(): Promise<AgentConfig[]> {
    return callSqliteWorker("agent", "findAll", []);
  }

  getActiveId(): Promise<string | null> {
    return callSqliteWorker("agent", "getActiveId", []);
  }

  listByProject(projectId?: string | null): Promise<AgentConfig[]> {
    return callSqliteWorker("agent", "listByProject", [projectId]);
  }

  create(input: AgentInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "create", [input]);
  }

  update(input: AgentUpdateInput): Promise<AgentConfig> {
    return callSqliteWorker("agent", "update", [input]);
  }

  delete(id: string): Promise<void> {
    return callSqliteWorker("agent", "delete", [id]);
  }

  setActive(id: string | null): Promise<void> {
    return callSqliteWorker("agent", "setActive", [id]);
  }
}
