import { describe, expect, test } from "bun:test";
import type { SessionRepositoryPort } from "#runtime/modules/session";
import type { SessionListPageQuery } from "#runtime/modules/session/application/ports/session-repository.port";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { StoredSession } from "#runtime/shared/types/session.types";
import { DashboardSessionAggregationService } from "./dashboard-session-aggregation.service";

const NOW = 1_700_000_000_000;

function createStoredSession(overrides: Partial<StoredSession>): StoredSession {
  return {
    id: "chat-1",
    userId: "user-1",
    projectRoot: "/repo/project-a",
    status: "stopped",
    createdAt: NOW,
    lastActiveAt: NOW,
    messages: [],
    ...overrides,
  };
}

function createSessionRepoStub(
  pages: StoredSession[][]
): SessionRepositoryPort {
  const calls: Array<{ cursor?: string }> = [];
  return {
    findPage(_userId: string, query?: SessionListPageQuery) {
      calls.push({ cursor: query?.cursor });
      const pageIndex = query?.cursor ? Number(query.cursor) : 0;
      const nextIndex = pageIndex + 1;
      return Promise.resolve({
        sessions: pages[pageIndex] ?? [],
        hasMore: nextIndex < pages.length,
        nextCursor: nextIndex < pages.length ? String(nextIndex) : undefined,
      });
    },
    calls,
  } as unknown as SessionRepositoryPort;
}

describe("DashboardSessionAggregationService", () => {
  test("computes global and per-project counters through one paged session scan", async () => {
    const sessionRepo = createSessionRepoStub([
      [
        createStoredSession({
          id: "chat-running",
          projectId: "project-a",
          status: "running",
          lastActiveAt: NOW - 60 * 60 * 1000,
          agentInfo: { title: "Codex" },
        }),
        createStoredSession({
          id: "chat-root-fallback",
          projectRoot: "/repo/project-b",
          lastActiveAt: NOW - 2 * 24 * 60 * 60 * 1000,
          agentInfo: { name: "Claude" },
        }),
      ],
      [
        createStoredSession({
          id: "chat-unknown-project",
          projectRoot: "/repo/missing",
          lastActiveAt: NOW - 8 * 24 * 60 * 60 * 1000,
        }),
      ],
    ]);
    const clock: ClockPort = { nowMs: () => NOW };
    const service = new DashboardSessionAggregationService(sessionRepo, clock);

    const result = await service.execute({
      userId: "user-1",
      projects: [
        { id: "project-a", path: "/repo/project-a" },
        { id: "project-b", path: "/repo/project-b" },
        { id: "project-c", path: "/repo/project-c" },
      ],
    });

    expect(result.totalSessions).toBe(3);
    expect(result.activeSessions).toBe(1);
    expect(result.recentSessions24h).toBe(1);
    expect(result.weeklySessions).toBe(2);
    expect(result.statsByProjectId.get("project-a")).toEqual({
      total: 1,
      running: 1,
    });
    expect(result.statsByProjectId.get("project-b")).toEqual({
      total: 1,
      running: 0,
    });
    expect(result.statsByProjectId.get("project-c")).toEqual({
      total: 0,
      running: 0,
    });
    expect(result.agentStats).toEqual({
      Codex: { count: 1, running: 1 },
      Claude: { count: 1, running: 0 },
      Unknown: { count: 1, running: 0 },
    });
  });
});
