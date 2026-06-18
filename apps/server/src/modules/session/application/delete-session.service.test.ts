import { describe, expect, test } from "bun:test";
import type { StoredSession } from "@/shared/types/session.types";
import { DeleteSessionService } from "./delete-session.service";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import type {
  AgentSessionLifecycleContext,
  AgentSessionStoppedContext,
  SessionDeletedContext,
  SessionLifecycleNotifier,
} from "./session-lifecycle.notifier";

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

describe("DeleteSessionService", () => {
  test("reports session deleted notification after persisted delete", async () => {
    const lifecycleCalls: unknown[] = [];
    const deleteCalls: Array<{ id: string; userId: string }> = [];
    const stored: StoredSession = {
      id: "chat-delete-1",
      userId: "user-1",
      projectRoot: "/repo/project",
      status: "stopped",
      createdAt: 1,
      lastActiveAt: 1,
      messages: [],
    };
    const repo = {
      findById: async () => stored,
      delete: (id: string, userId: string) => {
        deleteCalls.push({ id, userId });
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
    const service = new DeleteSessionService(
      repo,
      runtime,
      createSessionLifecycleNotifierStub(lifecycleCalls)
    );

    await service.execute("user-1", "chat-delete-1");

    expect(deleteCalls).toEqual([{ id: "chat-delete-1", userId: "user-1" }]);
    expect(lifecycleCalls).toEqual([
      [
        "deleted",
        {
          userId: "user-1",
          chatId: "chat-delete-1",
        },
      ],
    ]);
  });
});
