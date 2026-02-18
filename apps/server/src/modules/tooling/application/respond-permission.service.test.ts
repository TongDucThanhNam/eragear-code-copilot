import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { SessionRuntimePort } from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { RespondPermissionService } from "./respond-permission.service";

function createSession(userId: string): ChatSession {
  return {
    id: "chat-1",
    userId,
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: new EventEmitter(),
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
  };
}

describe("RespondPermissionService", () => {
  test("rejects cross-user permission response", async () => {
    const session = createSession("user-2");
    session.pendingPermissions.set("req-1", {
      resolve: () => undefined,
      options: [],
    });
    const service = new RespondPermissionService({
      get: () => session,
      set: () => undefined,
      delete: () => undefined,
      has: () => true,
      getAll: () => [session],
      runExclusive: async (_chatId, work) => await work(),
      broadcast: async () => undefined,
    } as SessionRuntimePort);

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "allow",
      })
    ).rejects.toThrow(/chat not found/i);
  });

  test("resolves pending permission for owning user", async () => {
    const session = createSession("user-1");
    const decisions: unknown[] = [];
    session.pendingPermissions.set("req-1", {
      resolve: (decision) => decisions.push(decision),
      options: [],
    });
    const service = new RespondPermissionService({
      get: () => session,
      set: () => undefined,
      delete: () => undefined,
      has: () => true,
      getAll: () => [session],
      runExclusive: async (_chatId, work) => await work(),
      broadcast: async () => undefined,
    } as SessionRuntimePort);

    await expect(
      service.execute({
        userId: "user-1",
        chatId: "chat-1",
        requestId: "req-1",
        decision: "allow",
      })
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    expect(decisions).toEqual([
      { outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    expect(session.pendingPermissions.size).toBe(0);
  });
});
