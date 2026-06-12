import { describe, expect, test } from "bun:test";
import type { ProjectRepositoryPort } from "@/modules/project";
import type { ClockPort } from "@/shared/ports/clock.port";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "@/shared/types/project.types";
import { GitService } from "./git.service";
import type {
  GitRepositoryPort,
  GitRepositoryReadResult,
} from "./ports/git-repository.port";

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

  create(_input: ProjectInput): Promise<Project> {
    throw new Error("not implemented");
  }

  update(_input: ProjectUpdateInput): Promise<Project> {
    throw new Error("not implemented");
  }

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.resolve();
  }

  setActive(_id: string | null, _userId: string): Promise<void> {
    return Promise.resolve();
  }
}

class GitRepoStub implements GitRepositoryPort {
  readonly calls: string[] = [];
  private readonly result: GitRepositoryReadResult;

  constructor(result: GitRepositoryReadResult) {
    this.result = result;
  }

  getRepositoryState(projectRoot: string): Promise<GitRepositoryReadResult> {
    this.calls.push(projectRoot);
    return Promise.resolve(this.result);
  }
}

function createClock(): ClockPort {
  return {
    nowMs: () => NOW_MS,
  };
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

describe("GitService", () => {
  test("returns repository summary for active project", async () => {
    const project = createProject();
    const git = new GitRepoStub({
      isRepository: true,
      branch: "main",
      head: "abc1234",
      upstream: "origin/main",
      ahead: 1,
      behind: 2,
      changedFiles: [
        {
          path: "src/index.ts",
          status: "modified",
          staged: false,
          unstaged: true,
        },
      ],
    });
    const service = new GitService(
      git,
      new ProjectRepoStub({ projects: [project], activeId: project.id }),
      createClock()
    );

    const summary = await service.getRepositorySummary("user-1");

    expect(git.calls).toEqual([project.path]);
    expect(summary).toMatchObject({
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.path,
      isRepository: true,
      branch: "main",
      totalChanged: 1,
      unstagedCount: 1,
      checkedAt: "2026-06-12T12:00:00.000Z",
    });
  });

  test("rejects missing active project", async () => {
    const service = new GitService(
      new GitRepoStub({
        isRepository: false,
        ahead: 0,
        behind: 0,
        changedFiles: [],
      }),
      new ProjectRepoStub({ projects: [], activeId: null }),
      createClock()
    );

    await expect(service.getRepositorySummary("user-1")).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });
});
