import { describe, expect, test } from "bun:test";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import { ListProjectsService } from "./list-projects.service";
import type {
  ProjectListWithActiveState,
  ProjectRepositoryPort,
} from "./ports/project-repository.port";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

class ProjectRepoStub implements ProjectRepositoryPort {
  listCalls: string[] = [];
  readModel: ProjectListWithActiveState;

  constructor(readModel: ProjectListWithActiveState) {
    this.readModel = readModel;
  }

  findById(_id: string, _userId: string): Promise<Project | undefined> {
    throw new Error("not used");
  }

  findByPath(_path: string): Promise<Project | undefined> {
    throw new Error("not used");
  }

  findAll(_userId: string): Promise<Project[]> {
    throw new Error("not used");
  }

  getActiveId(_userId: string): Promise<string | null> {
    throw new Error("not used");
  }

  listWithActiveState(userId: string): Promise<ProjectListWithActiveState> {
    this.listCalls.push(userId);
    return Promise.resolve(this.readModel);
  }

  create(_input: ProjectInput): Promise<Project> {
    throw new Error("not used");
  }

  update(_input: ProjectUpdateInput): Promise<Project> {
    throw new Error("not used");
  }

  delete(_id: string, _userId: string): Promise<void> {
    throw new Error("not used");
  }

  deleteAndClearActive(): Promise<{ activeProjectId: string | null }> {
    throw new Error("not used");
  }

  setActive(_id: string | null, _userId: string): Promise<void> {
    throw new Error("not used");
  }
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    userId: "user-1",
    name: "Repo",
    path: "C:/workspace/repo",
    description: null,
    tags: [],
    obsidianProjectPath: null,
    techStackTags: [],
    favorite: false,
    createdAt: NOW_MS,
    updatedAt: NOW_MS,
    lastOpenedAt: null,
    ...overrides,
  };
}

describe("ListProjectsService", () => {
  test("returns the repository project active-state read model", async () => {
    const project = createProject();
    const repo = new ProjectRepoStub({
      projects: [project],
      activeProjectId: project.id,
    });
    const service = new ListProjectsService(repo);

    await expect(service.execute("user-1")).resolves.toEqual({
      projects: [project],
      activeProjectId: project.id,
    });
    expect(repo.listCalls).toEqual(["user-1"]);
  });
});
