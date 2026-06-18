import { describe, expect, test } from "bun:test";
import type { StoredSession } from "@/shared/types/session.types";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type {
  AgentSessionLifecycleContext,
  AgentSessionStoppedContext,
  SessionDeletedContext,
  SessionLifecycleNotifier,
} from "./session-lifecycle.notifier";
import { StopSessionService } from "./stop-session.service";

function createSessionLifecycleNotifierStub(calls: unknown[] = []) {
  return {
    agentSessionCreated(input: AgentSessionLifecycleContext) {
      calls.push(["created", input]);
      return Promise.resolve();
    },
    agentSessionStopped(input: AgentSessionStoppedContext) {
      calls.push(["stopped", input]);
      return Promise.resolve();
    },
    sessionDeleted(input: SessionDeletedContext) {
      calls.push(["deleted", input]);
      return Promise.resolve();
    },
  } satisfies SessionLifecycleNotifier;
}

describe("StopSessionService", () => {
  test("reports agent session stopped notification after persisted stop", async () => {
    const lifecycleCalls: unknown[] = [];
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
      updateStatus: (
        id: string,
        userId: string,
        status: "running" | "stopped"
      ) => {
        statusUpdates.push({ id, userId, status });
        return Promise.resolve();
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
    const service = new StopSessionService(
      repo,
      runtime,
      createSessionLifecycleNotifierStub(lifecycleCalls)
    );

    await service.execute("user-1", "chat-stop-1");

    expect(statusUpdates).toEqual([
      { id: "chat-stop-1", userId: "user-1", status: "stopped" },
    ]);
    expect(lifecycleCalls).toEqual([
      [
        "stopped",
        {
          userId: "user-1",
          projectRoot: "/repo/project",
          projectId: "project-1",
          chatId: "chat-stop-1",
          agentSessionId: "agent-session-1",
        },
      ],
    ]);
  });
});
