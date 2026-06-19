import { describe, expect, test } from "bun:test";
import type { ProjectRepositoryPort } from "#runtime/modules/project/application/ports/project-repository.port";
import type {
  StoredMessage,
  StoredSession,
} from "#runtime/modules/session/domain/stored-session.types";
import type { ChatSession } from "#runtime/shared/types/session.types";
import type {
  SessionListPageQuery,
  SessionListPageResult,
  SessionListQuery,
  SessionMessageCompactionInput,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "../ports/session-repository.port";
import type { SessionRuntimePort } from "../ports/session-runtime.port";
import { SessionQueries } from "./session-queries";

class SessionRepoStub implements SessionRepositoryPort {
  sessions: StoredSession[] = [];
  maintenancePages: SessionListPageResult[] = [];
  messagesPage: SessionMessagesPageResult = {
    messages: [],
    hasMore: false,
  };
  compactCalls: SessionMessageCompactionInput[] = [];
  updateMetadataCalls: Array<{
    id: string;
    userId: string;
    updates: Partial<StoredSession>;
  }> = [];

  findById(id: string, userId: string): Promise<StoredSession | undefined> {
    return Promise.resolve(
      this.sessions.find(
        (session) => session.id === id && session.userId === userId
      )
    );
  }

  findAll(
    _userId: string,
    _query?: SessionListQuery
  ): Promise<StoredSession[]> {
    return Promise.resolve(this.sessions);
  }

  findAllForMaintenance(_query?: SessionListQuery): Promise<StoredSession[]> {
    return Promise.resolve([]);
  }

  findPage(
    _userId: string,
    _query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    return Promise.resolve({
      sessions: this.sessions,
      hasMore: false,
    });
  }

  findPageForMaintenance(
    query?: SessionListPageQuery
  ): Promise<SessionListPageResult> {
    if (!query?.cursor) {
      return Promise.resolve(
        this.maintenancePages[0] ?? { sessions: [], hasMore: false }
      );
    }
    return Promise.resolve(
      this.maintenancePages[1] ?? { sessions: [], hasMore: false }
    );
  }

  countAll(_userId: string): Promise<number> {
    return Promise.resolve(this.sessions.length);
  }

  create(session: StoredSession): Promise<void> {
    this.sessions.push(session);
    return Promise.resolve();
  }

  updateStatus(
    _id: string,
    _userId: string,
    _status: "running" | "stopped",
    _options?: { touchLastActiveAt?: boolean }
  ): Promise<void> {
    return Promise.resolve();
  }

  updateMetadata(
    id: string,
    userId: string,
    updates: Partial<StoredSession>
  ): Promise<void> {
    this.updateMetadataCalls.push({ id, userId, updates });
    return Promise.resolve();
  }

  delete(_id: string, _userId: string): Promise<void> {
    return Promise.resolve();
  }

  appendMessage(
    _id: string,
    _userId: string,
    _message: StoredMessage
  ): Promise<{ appended: true }> {
    return Promise.resolve({ appended: true });
  }

  replaceMessages(
    _id: string,
    _userId: string,
    _messages: StoredMessage[]
  ): Promise<{ replaced: true }> {
    return Promise.resolve({ replaced: true });
  }

  getMessageById(
    _id: string,
    _userId: string,
    messageId: string
  ): Promise<StoredMessage | undefined> {
    return Promise.resolve(
      this.messagesPage.messages.find((message) => message.id === messageId)
    );
  }

  getMessagesPage(
    _id: string,
    _userId: string,
    _query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    return Promise.resolve(this.messagesPage);
  }

  compactMessages(
    input: SessionMessageCompactionInput
  ): Promise<{ compacted: number }> {
    this.compactCalls.push(input);
    return Promise.resolve({ compacted: input.sessionIds.length });
  }

  getStorageStats(): Promise<SessionStorageStats> {
    return Promise.resolve({
      dbSizeBytes: 0,
      walSizeBytes: 0,
      freePages: 0,
      sessionCount: this.sessions.length,
      messageCount: this.messagesPage.messages.length,
      writeQueueDepth: 0,
    });
  }
}

function createProjectRepoStub(): ProjectRepositoryPort {
  const now = Date.now();
  const project = {
    id: "project-1",
    userId: "user-1",
    name: "Project",
    path: "/tmp/project",
    description: null,
    tags: [],
    obsidianProjectPath: null,
    techStackTags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
  };

  return {
    findById: async () => undefined,
    findByPath: async () => undefined,
    findAll: async () => [project],
    getActiveId: async () => null,
    listWithActiveState: async () => ({
      projects: [project],
      activeProjectId: null,
    }),
    create: async (input) => ({
      ...project,
      ...input,
    }),
    update: async (input) => ({
      ...project,
      ...input,
    }),
    delete: async () => undefined,
    deleteAndClearActive: () => Promise.resolve({ activeProjectId: null }),
    setActive: async () => undefined,
  };
}

function createRuntimeStub(session?: ChatSession): SessionRuntimePort {
  const sessions = session
    ? new Map<string, ChatSession>([[session.id, session]])
    : new Map<string, ChatSession>();

  return {
    set(chatId, nextSession) {
      sessions.set(chatId, nextSession);
    },
    get(chatId) {
      return sessions.get(chatId);
    },
    delete(chatId) {
      sessions.delete(chatId);
    },
    deleteIfMatch(chatId, expectedSession) {
      if (sessions.get(chatId) !== expectedSession) {
        return false;
      }
      sessions.delete(chatId);
      return true;
    },
    has(chatId) {
      return sessions.has(chatId);
    },
    getAll() {
      return [...sessions.values()];
    },
    runExclusive<T>(_chatId: string, work: () => Promise<T>): Promise<T> {
      return work();
    },
    isLockHeld() {
      return false;
    },
    broadcast: async () => undefined,
  };
}

function createStoredSession(
  id: string,
  status: "running" | "stopped" = "stopped"
): StoredSession {
  const now = Date.now();
  return {
    id,
    userId: "user-1",
    projectRoot: "/tmp/project",
    status,
    createdAt: now,
    lastActiveAt: now,
    messages: [],
  };
}

describe("SessionQueries", () => {
  test("lists sessions with runtime hydration and project backfill", async () => {
    const repo = new SessionRepoStub();
    repo.sessions = [createStoredSession("chat-1", "running")];
    const runtime = createRuntimeStub({
      id: "chat-1",
      userId: "user-1",
      chatStatus: "ready",
      loadSessionSupported: true,
      sessionInfo: { id: "remote-session", title: "Runtime title" },
      supportsModelSwitching: true,
    } as unknown as ChatSession);
    const queries = new SessionQueries(repo, runtime, createProjectRepoStub());

    const result = await queries.list("user-1", undefined, 20);

    expect(result[0]?.name).toBe("Runtime title");
    expect(result[0]?.projectId).toBe("project-1");
    expect(result[0]?.isActive).toBe(true);
    expect(repo.updateMetadataCalls).toEqual([
      {
        id: "chat-1",
        userId: "user-1",
        updates: { projectId: "project-1" },
      },
    ]);
  });

  test("maps compacted stored messages to UI messages", async () => {
    const repo = new SessionRepoStub();
    repo.sessions = [createStoredSession("chat-1")];
    repo.messagesPage = {
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          timestamp: 1000,
          isCompacted: true,
        },
      ],
      hasMore: false,
    };
    const queries = new SessionQueries(
      repo,
      createRuntimeStub(),
      createProjectRepoStub()
    );

    const result = await queries.messages({
      userId: "user-1",
      chatId: "chat-1",
      maxLimit: 50,
    });

    expect(result.messages[0]?.id).toBe("msg-1");
    expect(result.messages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "[Assistant message compacted for local retention]",
    });
  });

  test("compacts stopped sessions across maintenance pages", async () => {
    const repo = new SessionRepoStub();
    repo.maintenancePages = [
      {
        sessions: [
          createStoredSession("running-1", "running"),
          createStoredSession("stopped-1", "stopped"),
        ],
        nextCursor: "next-page",
        hasMore: true,
      },
      {
        sessions: [createStoredSession("stopped-2", "stopped")],
        hasMore: false,
      },
    ];
    const queries = new SessionQueries(
      repo,
      createRuntimeStub(),
      createProjectRepoStub()
    );

    const result = await queries.compact({
      beforeTimestamp: 1000,
      batchSize: 25,
    });

    expect(repo.compactCalls[0]?.sessionIds).toEqual([
      "stopped-1",
      "stopped-2",
    ]);
    expect(result).toEqual({
      compacted: 2,
      candidateCount: 3,
      stoppedSessionCount: 2,
    });
  });
});
