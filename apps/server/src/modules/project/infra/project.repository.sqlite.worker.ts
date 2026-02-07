import { callSqliteWorker } from "@/infra/storage/sqlite-worker-client";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import type { ProjectRepositoryPort } from "../application/ports/project-repository.port";

export class ProjectSqliteWorkerRepository implements ProjectRepositoryPort {
  async setAllowedRoots(roots: string[]): Promise<void> {
    await callSqliteWorker("storage", "setAllowedRoots", [roots]);
  }

  findById(id: string): Promise<Project | undefined> {
    return callSqliteWorker("project", "findById", [id]);
  }

  findAll(): Promise<Project[]> {
    return callSqliteWorker("project", "findAll", []);
  }

  getActiveId(): Promise<string | null> {
    return callSqliteWorker("project", "getActiveId", []);
  }

  create(input: ProjectInput): Promise<Project> {
    return callSqliteWorker("project", "create", [input]);
  }

  update(input: ProjectUpdateInput): Promise<Project> {
    return callSqliteWorker("project", "update", [input]);
  }

  delete(id: string): Promise<void> {
    return callSqliteWorker("project", "delete", [id]);
  }

  setActive(id: string | null): Promise<void> {
    return callSqliteWorker("project", "setActive", [id]);
  }
}
