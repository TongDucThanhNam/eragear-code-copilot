import { describe, expect, test } from "bun:test";
import type {
  StoredMessage,
  StoredSession,
} from "@/shared/types/session.types";
import { CompactSessionMessagesService } from "./compact-session-messages.service";
import type {
  SessionListQuery,
  SessionMessageCompactionInput,
  SessionMessagesPageQuery,
  SessionMessagesPageResult,
  SessionRepositoryPort,
  SessionStorageStats,
} from "./ports/session-repository.port";

class SessionRepoStub implements SessionRepositoryPort {
  sessionsForMaintenance: StoredSession[] = [];
  compactCalls: SessionMessageCompactionInput[] = [];

  findById(_id: string, _userId: string): Promise<StoredSession | undefined> {
    return Promise.resolve(undefined);
  }

  findAll(
    _userId: string,
    _query?: SessionListQuery
  ): Promise<StoredSession[]> {
    return Promise.resolve([]);
  }

  findAllForMaintenance(_query?: SessionListQuery): Promise<StoredSession[]> {
    return Promise.resolve(this.sessionsForMaintenance);
  }

  countAll(_userId: string): Promise<number> {
    return Promise.resolve(0);
  }

  save(_session: StoredSession): Promise<void> {
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
    _id: string,
    _userId: string,
    _updates: Partial<StoredSession>
  ): Promise<void> {
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

  getMessagesPage(
    _id: string,
    _userId: string,
    _query: SessionMessagesPageQuery
  ): Promise<SessionMessagesPageResult> {
    return Promise.resolve({
      messages: [],
      hasMore: false,
      nextCursor: undefined,
    });
  }

  compactMessages(
    input: SessionMessageCompactionInput
  ): Promise<{ compacted: number }> {
    this.compactCalls.push(input);
    return Promise.resolve({ compacted: Math.min(2, input.sessionIds.length) });
  }

  getStorageStats(): Promise<SessionStorageStats> {
    return Promise.resolve({
      dbSizeBytes: 0,
      walSizeBytes: 0,
      freePages: 0,
      sessionCount: 0,
      messageCount: 0,
      writeQueueDepth: 0,
    });
  }
}

function createSession(
  id: string,
  status: "running" | "stopped"
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

describe("CompactSessionMessagesService", () => {
  test("compacts only stopped sessions", async () => {
    const repo = new SessionRepoStub();
    repo.sessionsForMaintenance = [
      createSession("s-running", "running"),
      createSession("s-stopped-1", "stopped"),
      createSession("s-stopped-2", "stopped"),
    ];

    const service = new CompactSessionMessagesService(repo);
    const result = await service.execute({
      beforeTimestamp: 1000,
      batchSize: 50,
    });

    expect(repo.compactCalls).toHaveLength(1);
    expect(repo.compactCalls[0]?.sessionIds).toEqual([
      "s-stopped-1",
      "s-stopped-2",
    ]);
    expect(result.compacted).toBe(2);
    expect(result.candidateCount).toBe(3);
    expect(result.stoppedSessionCount).toBe(2);
  });

  test("returns zero compaction when no stopped candidates exist", async () => {
    const repo = new SessionRepoStub();
    repo.sessionsForMaintenance = [createSession("s-running", "running")];

    const service = new CompactSessionMessagesService(repo);
    const result = await service.execute({
      beforeTimestamp: 1000,
      batchSize: 50,
    });

    expect(repo.compactCalls).toHaveLength(0);
    expect(result).toEqual({
      compacted: 0,
      candidateCount: 1,
      stoppedSessionCount: 0,
    });
  });
});
