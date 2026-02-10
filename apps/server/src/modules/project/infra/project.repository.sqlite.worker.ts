import { callSqliteWorker } from "@/platform/storage/sqlite-worker-client";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import type { ProjectRepositoryPort } from "../application/ports/project-repository.port";

export class ProjectSqliteWorkerRepository implements ProjectRepositoryPort {
  findById(id: string, userId: string): Promise<Project | undefined> {
    return callSqliteWorker("project", "findById", [id, userId]);
  }

  findByPath(path: string): Promise<Project | undefined> {
    return callSqliteWorker("project", "findByPath", [path]);
  }

  findAll(userId: string): Promise<Project[]> {
    return callSqliteWorker("project", "findAll", [userId]);
  }

  getActiveId(userId: string): Promise<string | null> {
    return callSqliteWorker("project", "getActiveId", [userId]);
  }

  create(input: ProjectInput): Promise<Project> {
    return callSqliteWorker("project", "create", [input]);
  }

  update(input: ProjectUpdateInput): Promise<Project> {
    return callSqliteWorker("project", "update", [input]);
  }

  delete(id: string, userId: string): Promise<void> {
    return callSqliteWorker("project", "delete", [id, userId]);
  }

  setActive(id: string | null, userId: string): Promise<void> {
    return callSqliteWorker("project", "setActive", [id, userId]);
  }
}
