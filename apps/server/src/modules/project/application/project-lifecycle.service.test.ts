import { describe, expect, test } from "bun:test";
import type { SettingsRepositoryPort } from "@/modules/settings";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import { CreateProjectService } from "./create-project.service";
import { DeleteProjectService } from "./delete-project.service";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";
import { UpdateProjectService } from "./update-project.service";

class ProjectRepoStub implements ProjectRepositoryPort {
  projects: Project[] = [];
  activeId: string | null = null;
  createCalls: ProjectInput[] = [];
  setActiveCalls: Array<{ id: string | null; userId: string }> = [];
  deleteCalls: Array<{ id: string; userId: string }> = [];

  findById(id: string, userId: string): Promise<Project | undefined> {
    return Promise.resolve(
      this.projects.find(
        (project) => project.id === id && project.userId === userId
      )
    );
  }

  findByPath(path: string): Promise<Project | undefined> {
    return Promise.resolve(
      this.projects.find((project) => project.path === path)
    );
  }

  findAll(userId: string): Promise<Project[]> {
    return Promise.resolve(
      this.projects.filter((project) => project.userId === userId)
    );
  }

  getActiveId(_userId: string): Promise<string | null> {
    return Promise.resolve(this.activeId);
  }

  create(input: ProjectInput): Promise<Project> {
    this.createCalls.push(input);
    const now = Date.now();
    const created: Project = {
      id: `project-${this.createCalls.length}`,
      userId: input.userId,
      name: input.name,
      path: input.path,
      description: input.description ?? null,
      tags: input.tags ?? [],
      favorite: Boolean(input.favorite),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    };
    this.projects.push(created);
    return Promise.resolve(created);
  }

  async update(input: ProjectUpdateInput): Promise<Project> {
    const existing = await this.findById(input.id, input.userId);
    if (!existing) {
      throw new Error("Project not found");
    }
    const updated: Project = {
      ...existing,
      ...input,
      updatedAt: Date.now(),
    };
    this.projects = this.projects.map((project) =>
      project.id === input.id ? updated : project
    );
    return updated;
  }

  delete(id: string, userId: string): Promise<void> {
    this.deleteCalls.push({ id, userId });
    this.projects = this.projects.filter(
      (project) => !(project.id === id && project.userId === userId)
    );
    return Promise.resolve();
  }

  setActive(id: string | null, userId: string): Promise<void> {
    this.activeId = id;
    this.setActiveCalls.push({ id, userId });
    return Promise.resolve();
  }
}

function createSettingsRepoStub(roots: string[]): SettingsRepositoryPort {
  return {
    get: async () => ({
      ui: {
        theme: "system",
        accentColor: "#2563eb",
        density: "comfortable",
        fontScale: 1,
      },
      projectRoots: roots,
      mcpServers: [],
      app: {
        sessionIdleTimeoutMs: 10 * 60 * 1000,
        sessionListPageMaxLimit: 500,
        sessionMessagesPageMaxLimit: 200,
        logLevel: "info",
        maxTokens: 8192,
        defaultModel: "",
        acpPromptMetaPolicy: "allowlist",
        acpPromptMetaAllowlist: [],
      },
    }),
    update: (_patch) => Promise.reject(new Error("Not implemented")),
  };
}

function createEventBusStub(): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: async () => undefined,
  };
}

describe("Project lifecycle services", () => {
  test("createProject rejects empty project names", async () => {
    const repo = new ProjectRepoStub();
    const service = new CreateProjectService(
      repo,
      createSettingsRepoStub(["/workspace"]),
      createEventBusStub()
    );

    await expect(
      service.execute("user-1", {
        name: "   ",
        path: "/workspace/a",
      })
    ).rejects.toMatchObject({ name: "ValidationError" });
    expect(repo.createCalls).toHaveLength(0);
  });

  test("updateProject rejects duplicate paths", async () => {
    const repo = new ProjectRepoStub();
    const now = Date.now();
    repo.projects = [
      {
        id: "project-1",
        userId: "user-1",
        name: "A",
        path: "/workspace/a",
        description: null,
        tags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
      {
        id: "project-2",
        userId: "user-1",
        name: "B",
        path: "/workspace/b",
        description: null,
        tags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
    ];
    const service = new UpdateProjectService(
      repo,
      createSettingsRepoStub(["/workspace"]),
      createEventBusStub()
    );

    await expect(
      service.execute("user-1", {
        id: "project-1",
        path: "/workspace/b",
      })
    ).rejects.toMatchObject({ name: "ValidationError" });
  });

  test("deleteProject clears active project before deletion", async () => {
    const repo = new ProjectRepoStub();
    const now = Date.now();
    repo.projects = [
      {
        id: "project-10",
        userId: "user-1",
        name: "Project",
        path: "/workspace/project",
        description: null,
        tags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
    ];
    repo.activeId = "project-10";
    const service = new DeleteProjectService(repo, createEventBusStub());

    await service.execute("user-1", "project-10");

    expect(repo.setActiveCalls).toEqual([{ id: null, userId: "user-1" }]);
    expect(repo.deleteCalls).toEqual([{ id: "project-10", userId: "user-1" }]);
  });
});
