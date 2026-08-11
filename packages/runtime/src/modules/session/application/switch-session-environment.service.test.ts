import { describe, expect, test } from "bun:test";
import type { GitWorkflowPort } from "#runtime/modules/git";
import type { ProjectRepositoryPort } from "#runtime/modules/project";
import type {
  ChatSession,
  StoredSession,
} from "#runtime/shared/types/session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import { SwitchSessionEnvironmentService } from "./switch-session-environment.service";

const STORED_SESSION: StoredSession = {
  id: "chat-1",
  userId: "user-1",
  projectId: "project-1",
  projectRoot: "C:\\repo",
  command: "agent",
  args: ["acp"],
  env: { SAFE_KEY: "value" },
  status: "running",
  createdAt: 1,
  lastActiveAt: 2,
  messages: [],
};

describe("SwitchSessionEnvironmentService", () => {
  test("stops the active session and bootstraps the same chat in its worktree root", async () => {
    const calls: string[] = [];
    let metadata: Partial<StoredSession> | undefined;
    let createInput: Record<string, unknown> | undefined;
    const sessionRepo = {
      findById: () => Promise.resolve(STORED_SESSION),
      updateMetadata: (
        _chatId: string,
        _userId: string,
        updates: Partial<StoredSession>
      ) => {
        calls.push("metadata");
        metadata = updates;
        return Promise.resolve();
      },
    } as unknown as SessionRepositoryPort;
    const projectRepo = {
      findById: () =>
        Promise.resolve({
          id: "project-1",
          userId: "user-1",
          path: "C:\\repo",
        }),
    } as unknown as ProjectRepositoryPort;
    const workflow = {
      listWorktrees: () => {
        calls.push("list-worktrees");
        return Promise.resolve([]);
      },
      createWorktree: () => {
        calls.push("create-worktree");
        return Promise.resolve({
          path: "C:\\storage\\git-worktrees\\chat-1",
          branchName: "eragear/worktree/chat-1",
          bare: false,
          detached: false,
        });
      },
    } as unknown as GitWorkflowPort;
    const service = new SwitchSessionEnvironmentService(
      sessionRepo,
      projectRepo,
      workflow,
      {
        execute: () => {
          calls.push("stop");
          return Promise.resolve({ ok: true });
        },
      },
      {
        execute: (input) => {
          calls.push("create");
          createInput = input as unknown as Record<string, unknown>;
          return Promise.resolve({} as ChatSession);
        },
      },
      { get: () => undefined }
    );

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        envMode: "worktree",
      })
    ).resolves.toMatchObject({
      chatId: "chat-1",
      envMode: "worktree",
      projectRoot: "C:\\storage\\git-worktrees\\chat-1",
      worktreeBranch: "eragear/worktree/chat-1",
    });

    expect(calls).toEqual(["create-worktree", "stop", "metadata", "create"]);
    expect(metadata).toMatchObject({
      sessionId: undefined,
      status: "stopped",
      projectRoot: "C:\\storage\\git-worktrees\\chat-1",
      cwd: "C:\\storage\\git-worktrees\\chat-1",
      envMode: "worktree",
    });
    expect(createInput).toMatchObject({
      chatId: "chat-1",
      projectId: "project-1",
      projectRoot: "C:\\storage\\git-worktrees\\chat-1",
      trustedProjectRoot: "C:\\storage\\git-worktrees\\chat-1",
      envMode: "worktree",
      importExternalHistoryOnLoad: false,
    });
  });

  test("synchronizes changed worktree branch metadata for stored and live state", async () => {
    const stored = {
      ...STORED_SESSION,
      envMode: "worktree" as const,
      worktreePath: "C:\\storage\\git-worktrees\\chat-1",
      worktreeBranch: "eragear/worktree/chat-1",
      projectRoot: "C:\\storage\\git-worktrees\\chat-1",
    };
    let metadata: Partial<StoredSession> | undefined;
    const runtime = {
      userId: "user-1",
      worktreeBranch: stored.worktreeBranch,
    } as ChatSession;
    const service = new SwitchSessionEnvironmentService(
      {
        findById: () => Promise.resolve(stored),
        updateMetadata: (
          _chatId: string,
          _userId: string,
          updates: Partial<StoredSession>
        ) => {
          metadata = updates;
          return Promise.resolve();
        },
      } as unknown as SessionRepositoryPort,
      {} as ProjectRepositoryPort,
      {
        getStatus: () =>
          Promise.resolve({
            isRepository: true,
            refName: "feature/renamed",
          }),
      } as unknown as GitWorkflowPort,
      { execute: () => Promise.resolve({ ok: true }) },
      { execute: () => Promise.resolve({} as ChatSession) },
      { get: () => runtime }
    );

    await expect(
      service.syncBranch({ userId: "user-1", chatId: "chat-1" })
    ).resolves.toEqual({ worktreeBranch: "feature/renamed" });
    expect(metadata).toEqual({ worktreeBranch: "feature/renamed" });
    expect(runtime.worktreeBranch).toBe("feature/renamed");
  });
});
