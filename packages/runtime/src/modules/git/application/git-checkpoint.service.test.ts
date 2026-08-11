import { describe, expect, test } from "bun:test";
import {
  type ProjectRepositoryPort,
  ResolveActiveProjectService,
} from "#runtime/modules/project";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type {
  Project,
  ProjectInput,
  ProjectUpdateInput,
} from "#runtime/shared/types/project.types";
import type {
  GitCheckpoint,
  GitTurnCheckpoint,
  TurnDiffFile,
} from "./contracts/git.contract";
import { GitCheckpointService } from "./git-checkpoint.service";
import type {
  GitCheckpointCreateParams,
  GitCheckpointPort,
  GitCheckpointRestoreParams,
  GitCheckpointRestorePortResult,
  GitTurnCheckpointCaptureParams,
  GitTurnCheckpointDiffParams,
  GitTurnCheckpointRestoreParams,
  GitTurnCheckpointRestoreResult,
} from "./ports/git-checkpoint.port";
import { buildTurnCheckpointRef } from "./turn-diff-parser";

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

  findByPath(projectPath: string): Promise<Project | undefined> {
    return Promise.resolve(
      this.projects.find((project) => project.path === projectPath)
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

class GitCheckpointStub implements GitCheckpointPort {
  readonly createCalls: GitCheckpointCreateParams[] = [];
  readonly restoreCalls: GitCheckpointRestoreParams[] = [];
  private readonly checkpoints: GitCheckpoint[] = [];
  readonly turnCheckpoints: GitTurnCheckpoint[] = [];
  readonly turnRestoreCalls: GitTurnCheckpointRestoreParams[] = [];

  createCheckpoint(params: GitCheckpointCreateParams): Promise<GitCheckpoint> {
    this.createCalls.push(params);
    const checkpoint: GitCheckpoint = {
      id: `checkpoint-00000000-0000-4000-8000-${String(this.createCalls.length).padStart(12, "0")}`,
      name: params.name ?? "Checkpoint",
      kind: params.kind,
      projectRoot: params.projectRoot,
      createdAt: new Date(NOW_MS + this.createCalls.length).toISOString(),
      changedFiles: [],
      statusLines: [],
      patchBytes: 1,
      canRestore: true,
      diagnostics: [],
    };
    if (params.projectId) {
      checkpoint.projectId = params.projectId;
    }
    if (params.projectName) {
      checkpoint.projectName = params.projectName;
    }
    if (params.chatId) {
      checkpoint.chatId = params.chatId;
    }
    if (params.agentSessionId) {
      checkpoint.agentSessionId = params.agentSessionId;
    }
    if (params.turnId) {
      checkpoint.turnId = params.turnId;
    }
    this.checkpoints.unshift(checkpoint);
    return Promise.resolve(checkpoint);
  }

  listCheckpoints(): Promise<GitCheckpoint[]> {
    return Promise.resolve(this.checkpoints);
  }

  restoreCheckpoint(
    params: GitCheckpointRestoreParams
  ): Promise<GitCheckpointRestorePortResult> {
    this.restoreCalls.push(params);
    const checkpoint = this.checkpoints[0];
    if (!checkpoint) {
      throw new Error("missing checkpoint");
    }
    const restoredAt = new Date(NOW_MS).toISOString();
    return Promise.resolve({
      checkpoint: {
        ...checkpoint,
        canRestore: false,
        restoredAt,
      },
      restoredAt,
    });
  }

  captureTurnCheckpoint(
    params: GitTurnCheckpointCaptureParams
  ): Promise<GitTurnCheckpoint> {
    const checkpoint: GitTurnCheckpoint = {
      sessionId: params.sessionId,
      ...(params.turnId ? { turnId: params.turnId } : {}),
      turnCount: params.turnCount,
      kind: params.kind,
      ref: buildTurnCheckpointRef(params.sessionId, params.turnCount),
      commitSha: String(params.turnCount + 1).padStart(40, "0"),
      createdAt: new Date(NOW_MS + params.turnCount).toISOString(),
    };
    this.turnCheckpoints.push(checkpoint);
    return Promise.resolve(checkpoint);
  }

  listTurnCheckpoints(params: {
    sessionId: string;
  }): Promise<GitTurnCheckpoint[]> {
    return Promise.resolve(
      this.turnCheckpoints.filter(
        (checkpoint) => checkpoint.sessionId === params.sessionId
      )
    );
  }

  diffTurnCheckpoints(
    _params: GitTurnCheckpointDiffParams
  ): Promise<TurnDiffFile[]> {
    return Promise.resolve([]);
  }

  restoreTurnCheckpoint(
    params: GitTurnCheckpointRestoreParams
  ): Promise<GitTurnCheckpointRestoreResult> {
    this.turnRestoreCalls.push(params);
    return Promise.resolve({
      restoredRef: params.targetRef,
      safetyRef: `${params.targetRef}-safety-test`,
    });
  }

  deleteTurnCheckpointsAfter(params: {
    sessionId: string;
    turnCount: number;
  }): Promise<{ deletedRefs: string[] }> {
    const deletedRefs = this.turnCheckpoints
      .filter(
        (checkpoint) =>
          checkpoint.sessionId === params.sessionId &&
          checkpoint.turnCount > params.turnCount
      )
      .map((checkpoint) => checkpoint.ref);
    return Promise.resolve({ deletedRefs });
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

function createActiveProjectResolver(projectRepo: ProjectRepositoryPort) {
  return new ResolveActiveProjectService(projectRepo);
}

describe("GitCheckpointService", () => {
  test("creates a manual checkpoint for the active project", async () => {
    const project = createProject();
    const git = new GitCheckpointStub();
    const projectRepo = new ProjectRepoStub({
      projects: [project],
      activeId: project.id,
    });
    const service = new GitCheckpointService(
      git,
      projectRepo,
      createActiveProjectResolver(projectRepo),
      createClock()
    );

    const result = await service.createCheckpoint("user-1", {
      name: "Before task",
    });

    expect(git.createCalls).toEqual([
      expect.objectContaining({
        projectRoot: project.path,
        projectId: project.id,
        projectName: project.name,
        name: "Before task",
        kind: "manual",
      }),
    ]);
    expect(result.checkpoints).toEqual([
      expect.objectContaining({
        name: "Before task",
        kind: "manual",
      }),
    ]);
  });

  test("creates automatic checkpoints only for owned matching project roots", async () => {
    const project = createProject();
    const git = new GitCheckpointStub();
    const projectRepo = new ProjectRepoStub({
      projects: [project],
      activeId: project.id,
    });
    const service = new GitCheckpointService(
      git,
      projectRepo,
      createActiveProjectResolver(projectRepo),
      createClock()
    );

    await service.createAutomaticCheckpoint({
      userId: "user-1",
      projectId: project.id,
      projectRoot: project.path,
      chatId: "chat-1",
      agentSessionId: "acp-session-1",
      turnId: "turn-1",
    });

    expect(git.createCalls).toEqual([
      expect.objectContaining({
        kind: "auto",
        projectRoot: project.path,
        projectId: project.id,
        chatId: "chat-1",
        agentSessionId: "acp-session-1",
        turnId: "turn-1",
      }),
    ]);
    await expect(
      service.createAutomaticCheckpoint({
        userId: "user-1",
        projectId: project.id,
        projectRoot: "C:/workspace/other",
      })
    ).rejects.toMatchObject({ name: "ValidationError" });
  });

  test("captures baseline and sequential turn refs without touching legacy checkpoints", async () => {
    const project = createProject();
    const git = new GitCheckpointStub();
    const projectRepo = new ProjectRepoStub({
      projects: [project],
      activeId: project.id,
    });
    const service = new GitCheckpointService(
      git,
      projectRepo,
      createActiveProjectResolver(projectRepo),
      createClock()
    );
    const lifecycle = {
      userId: "user-1",
      projectId: project.id,
      projectRoot: project.path,
      chatId: "chat-1",
      turnId: "turn-1",
    };

    const baseline = await service.captureTurnBaseline(lifecycle);
    const diff = await service.captureCompletedTurn(lifecycle);

    expect(baseline).toMatchObject({
      kind: "baseline",
      turnCount: 0,
      ref: "refs/eragear/session-chat-1-turn-0",
    });
    expect(diff.from.ref).toBe("refs/eragear/session-chat-1-turn-0");
    expect(diff.to).toMatchObject({
      kind: "turn",
      turnId: "turn-1",
      turnCount: 1,
      ref: "refs/eragear/session-chat-1-turn-1",
    });
    expect(git.createCalls).toEqual([]);
  });

  test("restores a turn, rolls back conversation, and deletes stale refs", async () => {
    const project = createProject();
    const git = new GitCheckpointStub();
    const rollbackCalls: unknown[] = [];
    const projectRepo = new ProjectRepoStub({
      projects: [project],
      activeId: project.id,
    });
    const service = new GitCheckpointService(
      git,
      projectRepo,
      createActiveProjectResolver(projectRepo),
      createClock(),
      {
        execute: (input) => {
          rollbackCalls.push(input);
          return Promise.resolve({ replayedMessages: 2 });
        },
      }
    );
    const lifecycle = {
      userId: "user-1",
      projectId: project.id,
      projectRoot: project.path,
      chatId: "chat-1",
    };
    await service.captureTurnBaseline({ ...lifecycle, turnId: "turn-1" });
    await service.captureCompletedTurn({ ...lifecycle, turnId: "turn-1" });
    await service.captureCompletedTurn({ ...lifecycle, turnId: "turn-2" });

    const result = await service.revertTurnCheckpoint("user-1", {
      projectId: project.id,
      sessionId: "chat-1",
      turnCount: 1,
    });

    expect(git.turnRestoreCalls).toEqual([
      {
        projectRoot: project.path,
        targetRef: "refs/eragear/session-chat-1-turn-1",
        fallbackToHead: false,
      },
    ]);
    expect(rollbackCalls).toEqual([
      {
        userId: "user-1",
        sessionId: "chat-1",
        projectRoot: project.path,
        turnCount: 1,
      },
    ]);
    expect(result).toMatchObject({
      checkpoint: { turnCount: 1 },
      rolledBackTurns: 1,
      replayedMessages: 2,
      deletedRefs: ["refs/eragear/session-chat-1-turn-2"],
    });
  });
});
