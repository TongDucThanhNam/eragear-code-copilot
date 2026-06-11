import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import type { StoredSession } from "@/shared/types/session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { StopSessionService } from "./stop-session.service";

describe("StopSessionService", () => {
  test("publishes local ADE lifecycle event after persisted stop", async () => {
    const events: DomainEvent[] = [];
    const statusUpdates: Array<{
      id: string;
      userId: string;
      status: "running" | "stopped";
    }> = [];
    const stored: StoredSession = {
      id: "chat-stop-1",
      userId: "user-1",
      projectId: "project-1",
      projectRoot: "/repo/project",
      sessionId: "agent-session-1",
      status: "running",
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
    };
    const repo = {
      findById: async () => stored,
      updateStatus: async (
        id: string,
        userId: string,
        status: "running" | "stopped"
      ) => {
        statusUpdates.push({ id, userId, status });
      },
    } as unknown as SessionRepositoryPort;
    let lockHeld = false;
    const runtime = {
      runExclusive: async (_chatId: string, fn: () => Promise<void>) => {
        lockHeld = true;
        try {
          await fn();
        } finally {
          lockHeld = false;
        }
      },
      isLockHeld: () => lockHeld,
      get: () => undefined,
      deleteIfMatch: () => false,
    } as unknown as SessionRuntimePort;
    const service = new StopSessionService(repo, runtime, {
      subscribe: () => () => undefined,
      publish: async (event) => {
        events.push(event);
      },
    });

    await service.execute("user-1", "chat-stop-1");

    expect(statusUpdates).toEqual([
      { id: "chat-stop-1", userId: "user-1", status: "stopped" },
    ]);
    expect(events).toContainEqual({
      type: "local_ade_lifecycle",
      event: "after-agent-session-stop",
      userId: "user-1",
      projectRoot: "/repo/project",
      projectId: "project-1",
      chatId: "chat-stop-1",
      agentSessionId: "agent-session-1",
    });
    expect(events).toContainEqual({
      type: "dashboard_refresh",
      reason: "session_stopped",
      userId: "user-1",
      chatId: "chat-stop-1",
    });
  });
});
