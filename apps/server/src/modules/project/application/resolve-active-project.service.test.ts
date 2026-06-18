import { describe, expect, test } from "bun:test";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";
import { ResolveActiveProjectService } from "./resolve-active-project.service";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

class ProjectRepoStub implements ProjectRepositoryPort {
  private readonly projects: Project[];
  private readonly activeId: string | null;

  constructor(params: { projects: Project[]; activeId: string | null }) {
    this.projects = params.projects;
    this.activeId = params.activeId;
  }

  findById(id: string, userId: string): Promise<Project | undefined> {
    return Promise.resolve(
      this.projects.find(
        (project) => project.id === id && project.userId === userId
      )
    );
  }

  findByPath(_path: string): Promise<Project | undefined> {
    return Promise.resolve(undefined);
  }

  findAll(userId: string): Promise<Project[]> {
    return Promise.resolve(
      this.projects.filter((project) => project.userId === userId)
    );
  }

  getActiveId(_userId: string): Promise<string | null> {
    return Promise.resolve(this.activeId);
  }

  listWithActiveState(userId: string) {
    return Promise.resolve({
      projects: this.projects.filter((project) => project.userId === userId),
      activeProjectId: this.activeId,
    });
  }

  create(_input: ProjectInput): Promise<Project> {
    throw new Error("not implemented");
  }

  update(_input: ProjectUpdateInput): Promise<Project> {
    throw new Error("not implemented");
  }

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.resolve();
  }

  deleteAndClearActive(): Promise<{ activeProjectId: string | null }> {
    return Promise.resolve({ activeProjectId: null });
  }

  setActive(_id: string | null, _userId: string): Promise<void> {
    return Promise.resolve();
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

describe("ResolveActiveProjectService", () => {
  test("returns the active project row", async () => {
    const project = createProject();
    const service = new ResolveActiveProjectService(
      new ProjectRepoStub({ projects: [project], activeId: project.id })
    );

    await expect(service.execute("user-1")).resolves.toBe(project);
  });

  test("rejects when no active project is selected", async () => {
    const service = new ResolveActiveProjectService(
      new ProjectRepoStub({ projects: [], activeId: null })
    );

    await expect(
      service.execute("user-1", {
        module: "git",
        op: "git.resolve-project",
      })
    ).rejects.toMatchObject({
      name: "NotFoundError",
      module: "git",
      op: "git.resolve-project",
    });
  });

  test("rejects dangling active project state", async () => {
    const service = new ResolveActiveProjectService(
      new ProjectRepoStub({ projects: [], activeId: "missing-project" })
    );

    await expect(service.execute("user-1")).rejects.toMatchObject({
      name: "NotFoundError",
      module: "project",
      op: "project.resolve-active",
      details: { projectId: "missing-project" },
    });
  });
});
