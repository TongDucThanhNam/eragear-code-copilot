import { describe, expect, test } from "bun:test";
import type { TaskAutoArchiveSettings } from "./contracts/task-auto-archive.contract";
import type {
  MutableTaskAutoArchiveStoreSnapshot,
  TaskAutoArchiveRepositoryPort,
  TaskAutoArchiveStoreSnapshot,
} from "./ports/task-auto-archive-repository.port";
import type {
  TaskAutoArchiveSession,
  TaskAutoArchiveSessionPage,
  TaskAutoArchiveSessionPort,
} from "./ports/task-auto-archive-session.port";
import { TaskAutoArchiveService } from "./task-auto-archive.service";

class TaskAutoArchiveRepositoryStub implements TaskAutoArchiveRepositoryPort {
  readonly snapshot: MutableTaskAutoArchiveStoreSnapshot = {
    settingsByUserId: {},
    lastRunByUserId: {},
  };

  constructor(entries: [string, TaskAutoArchiveSettings][] = []) {
    for (const [userId, settings] of entries) {
      this.snapshot.settingsByUserId[userId] = settings;
    }
  }

  async read<T>(
    reader: (snapshot: TaskAutoArchiveStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await reader(this.snapshot);
  }

  async mutate<T>(
    mutator: (snapshot: MutableTaskAutoArchiveStoreSnapshot) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.snapshot);
  }
}

class TaskAutoArchiveSessionStub implements TaskAutoArchiveSessionPort {
  readonly archivedSessionIds: string[] = [];
  private readonly sessions: TaskAutoArchiveSession[];
  private readonly activeIds: Set<string>;

  constructor(sessions: TaskAutoArchiveSession[], activeIds: string[] = []) {
    this.sessions = sessions;
    this.activeIds = new Set(activeIds);
  }

  listPage(input?: {
    cursor?: string;
    limit?: number;
  }): Promise<TaskAutoArchiveSessionPage> {
    const offset = input?.cursor ? Number(input.cursor) : 0;
    const limit = input?.limit ?? this.sessions.length;
    const sessions = this.sessions.slice(offset, offset + limit);
    const nextOffset = offset + sessions.length;
    return Promise.resolve({
      sessions,
      nextCursor:
        nextOffset < this.sessions.length ? String(nextOffset) : undefined,
      hasMore: nextOffset < this.sessions.length,
    });
  }

  archiveSession(id: string): Promise<void> {
    this.archivedSessionIds.push(id);
    return Promise.resolve();
  }

  isActiveSession(id: string): boolean {
    return this.activeIds.has(id);
  }
}

const NOW = Date.UTC(2026, 5, 12, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function enabledSettings(): TaskAutoArchiveSettings {
  return {
    enabled: true,
    olderThanDays: 7,
    userConfigured: true,
    updatedAt: new Date(NOW).toISOString(),
  };
}

function session(
  id: string,
  overrides: Partial<TaskAutoArchiveSession> = {}
): TaskAutoArchiveSession {
  return {
    id,
    userId: "user-1",
    status: "stopped",
    lastActiveAt: NOW - 10 * DAY,
    ...overrides,
  };
}

describe("TaskAutoArchiveService", () => {
  test("archives only old stopped unpinned sessions", async () => {
    const repository = new TaskAutoArchiveRepositoryStub([
      ["user-1", enabledSettings()],
    ]);
    const sessions = new TaskAutoArchiveSessionStub(
      [
        session("old"),
        session("recent", { lastActiveAt: NOW - DAY }),
        session("pinned", { pinned: true }),
        session("running", { status: "running" }),
        session("archived", { archived: true }),
        session("active-runtime"),
      ],
      ["active-runtime"]
    );
    const service = new TaskAutoArchiveService({
      repository,
      sessions,
      nowMs: () => NOW,
    });

    const result = await service.run("user-1");

    expect(result.archived).toBe(1);
    expect(result.eligible).toBe(1);
    expect(result.skippedRecent).toBe(1);
    expect(result.skippedPinned).toBe(1);
    expect(result.skippedRunning).toBe(2);
    expect(result.skippedArchived).toBe(1);
    expect(sessions.archivedSessionIds).toEqual(["old"]);
    expect(repository.snapshot.lastRunByUserId["user-1"]?.archived).toBe(1);
    expect(repository.snapshot.settingsByUserId["user-1"]?.lastRunAt).toBe(
      new Date(NOW).toISOString()
    );
  });

  test("does not inspect sessions when policy is disabled", async () => {
    const service = new TaskAutoArchiveService({
      repository: new TaskAutoArchiveRepositoryStub(),
      sessions: new TaskAutoArchiveSessionStub([session("old")]),
      nowMs: () => NOW,
    });

    const result = await service.run("user-1");

    expect(result.inspected).toBe(0);
    expect(result.archived).toBe(0);
    expect(result.diagnostics).toContain(
      "Task auto-archive is disabled for user-1."
    );
  });
});
