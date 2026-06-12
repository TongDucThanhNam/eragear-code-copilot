import { describe, expect, test } from "bun:test";
import type {
  TaskAutoArchiveRunResult,
  TaskAutoArchiveSettings,
} from "./contracts/task-auto-archive.contract";
import type { TaskAutoArchiveRepositoryPort } from "./ports/task-auto-archive-repository.port";
import type {
  TaskAutoArchiveSession,
  TaskAutoArchiveSessionPage,
  TaskAutoArchiveSessionPort,
} from "./ports/task-auto-archive-session.port";
import { TaskAutoArchiveService } from "./task-auto-archive.service";

class TaskAutoArchiveRepositoryStub implements TaskAutoArchiveRepositoryPort {
  readonly lastRuns = new Map<string, TaskAutoArchiveRunResult>();
  private readonly settings = new Map<string, TaskAutoArchiveSettings>();

  constructor(entries: [string, TaskAutoArchiveSettings][] = []) {
    for (const [userId, settings] of entries) {
      this.settings.set(userId, settings);
    }
  }

  getSettings(userId: string): Promise<TaskAutoArchiveSettings | null> {
    return Promise.resolve(this.settings.get(userId) ?? null);
  }

  saveSettings(
    userId: string,
    settings: TaskAutoArchiveSettings
  ): Promise<TaskAutoArchiveSettings> {
    this.settings.set(userId, settings);
    return Promise.resolve(settings);
  }

  getLastRun(userId: string): Promise<TaskAutoArchiveRunResult | null> {
    return Promise.resolve(this.lastRuns.get(userId) ?? null);
  }

  saveLastRun(userId: string, result: TaskAutoArchiveRunResult): Promise<void> {
    this.lastRuns.set(userId, result);
    return Promise.resolve();
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
    expect(repository.lastRuns.get("user-1")?.archived).toBe(1);
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
