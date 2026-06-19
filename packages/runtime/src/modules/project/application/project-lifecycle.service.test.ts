import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { SettingsRepositoryPort } from "#runtime/modules/settings";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "#runtime/shared/types/project.types";
import { CreateProjectService } from "./create-project.service";
import { DeleteProjectService } from "./delete-project.service";
import type { ProjectRepositoryPort } from "./ports/project-repository.port";
import type {
  ProjectDeletionIdentity,
  ProjectIdentity,
  ProjectLifecycleNotifier,
} from "./project-lifecycle.notifier";
import { UpdateProjectService } from "./update-project.service";

class ProjectRepoStub implements ProjectRepositoryPort {
  projects: Project[] = [];
  activeId: string | null = null;
  createCalls: ProjectInput[] = [];
  setActiveCalls: Array<{ id: string | null; userId: string }> = [];
  deleteCalls: Array<{ id: string; userId: string }> = [];
  deleteAndClearActiveCalls: Array<{ id: string; userId: string }> = [];

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

  listWithActiveState(userId: string) {
    return Promise.resolve({
      projects: this.projects.filter((project) => project.userId === userId),
      activeProjectId: this.activeId,
    });
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
      obsidianProjectPath: input.obsidianProjectPath ?? null,
      techStackTags: input.techStackTags ?? [],
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

  deleteAndClearActive(
    id: string,
    userId: string
  ): Promise<{ activeProjectId: string | null }> {
    this.deleteAndClearActiveCalls.push({ id, userId });
    this.projects = this.projects.filter(
      (project) => !(project.id === id && project.userId === userId)
    );
    if (this.activeId === id) {
      this.activeId = null;
    }
    return Promise.resolve({ activeProjectId: this.activeId });
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
        showReasoning: true,
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
        supervisorEnabled: false,
        supervisorModel: "",
        supervisorDeepSeekApiKey: "",
        supervisorDecisionTimeoutMs: 30_000,
        supervisorDecisionMaxAttempts: 2,
        supervisorMaxRuntimeMs: 1_800_000,
        supervisorMaxRepeatedPrompts: 20,
        supervisorWebSearchProvider: "none",
        supervisorWebSearchApiKey: "",
        supervisorMemoryProvider: "none",
        supervisorObsidianCommand: "obsidian",
        supervisorObsidianVault: "",
        supervisorObsidianBlueprintPath: "",
        supervisorObsidianLogPath: "",
        supervisorObsidianSearchPath: "Project",
        supervisorObsidianSearchLimit: 3,
        supervisorObsidianTimeoutMs: 5000,
        projectIndexEmbeddingEndpoint: "",
        projectIndexEmbeddingModel: "text-embedding-3-small",
        projectIndexEmbeddingApiKey: "",
        projectIndexEmbeddingTimeoutMs: 10_000,
        acpPromptMetaPolicy: "allowlist",
        acpPromptMetaAllowlist: [],
      },
    }),
    save: (_settings) => Promise.reject(new Error("Not implemented")),
  };
}

function createProjectLifecycleNotifierStub(calls: unknown[] = []) {
  return {
    projectCreated(input: ProjectIdentity) {
      calls.push(["created", input]);
      return Promise.resolve();
    },
    projectUpdated(input: ProjectIdentity) {
      calls.push(["updated", input]);
      return Promise.resolve();
    },
    projectSetActive(input: { userId: string; projectId?: string }) {
      calls.push(["setActive", input]);
      return Promise.resolve();
    },
    beforeProjectDelete(input: ProjectDeletionIdentity) {
      calls.push(["beforeDelete", input]);
      return Promise.resolve();
    },
    afterProjectDeleted(input: ProjectDeletionIdentity) {
      calls.push(["afterDelete", input]);
      return Promise.resolve();
    },
  } satisfies ProjectLifecycleNotifier;
}

describe("Project lifecycle services", () => {
  test("createProject rejects empty project names", async () => {
    const repo = new ProjectRepoStub();
    const service = new CreateProjectService(
      repo,
      createSettingsRepoStub(["/workspace"]),
      createProjectLifecycleNotifierStub()
    );

    await expect(
      service.execute("user-1", {
        name: "   ",
        path: path.resolve("/workspace/a"),
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
        obsidianProjectPath: null,
        techStackTags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
      {
        id: "project-2",
        userId: "user-1",
        name: "B",
        path: path.resolve("/workspace/b"),
        description: null,
        tags: [],
        obsidianProjectPath: null,
        techStackTags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
    ];
    const service = new UpdateProjectService(
      repo,
      createSettingsRepoStub(["/workspace"]),
      createProjectLifecycleNotifierStub()
    );

    await expect(
      service.execute("user-1", {
        id: "project-1",
        path: "/workspace/b",
      })
    ).rejects.toMatchObject({ name: "ValidationError" });
  });

  test("deleteProject uses the active-state lifecycle repository operation", async () => {
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
        obsidianProjectPath: null,
        techStackTags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
      },
    ];
    repo.activeId = "project-10";
    const lifecycleCalls: unknown[] = [];
    const service = new DeleteProjectService(
      repo,
      createProjectLifecycleNotifierStub(lifecycleCalls)
    );

    await service.execute("user-1", "project-10");

    expect(repo.setActiveCalls).toEqual([]);
    expect(repo.deleteCalls).toEqual([]);
    expect(repo.deleteAndClearActiveCalls).toEqual([
      { id: "project-10", userId: "user-1" },
    ]);
    expect(lifecycleCalls).toEqual([
      [
        "beforeDelete",
        {
          userId: "user-1",
          projectId: "project-10",
          projectPath: "/workspace/project",
        },
      ],
      [
        "afterDelete",
        {
          userId: "user-1",
          projectId: "project-10",
          projectPath: "/workspace/project",
        },
      ],
    ]);
  });
});
