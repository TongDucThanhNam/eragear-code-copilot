import { describe, expect, test } from "bun:test";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { createSessionHandlers, serializeRawPayloadForLog } from "./handlers";
import { SessionBuffering } from "./update";

function createSession(chatId: string): ChatSession {
  return {
    id: chatId,
    userId: "user-1",
    proc: {} as ChatSession["proc"],
    conn: {} as ChatSession["conn"],
    projectRoot: "/tmp/project",
    emitter: {} as ChatSession["emitter"],
    cwd: "/tmp/project",
    subscriberCount: 0,
    messageBuffer: [],
    pendingPermissions: new Map(),
    toolCalls: new Map(),
    terminals: new Map(),
    uiState: createUiMessageState(),
    chatStatus: "ready",
    modes: {
      currentModeId: "mode-old",
      availableModes: [{ id: "mode-old", name: "Old" }],
    },
  } satisfies Partial<ChatSession> as ChatSession;
}

describe("createSessionHandlers", () => {
  test("drops invalid sessionUpdate payloads without mutating runtime state", async () => {
    const session = createSession("chat-invalid-ingress");
    const events: unknown[] = [];
    const runtime = {
      get(chatId: string) {
        return chatId === session.id ? session : undefined;
      },
      broadcast(_chatId: string, event: unknown) {
        events.push(event);
        return Promise.resolve();
      },
      async runExclusive<T>(
        _chatId: string,
        work: () => Promise<T>
      ): Promise<T> {
        return await work();
      },
    } as unknown as SessionRuntimePort;

    const metadataCalls: Array<{
      chatId: string;
      userId: string;
      updates: Record<string, unknown>;
    }> = [];
    const repo = {
      updateMetadata: (
        chatId: string,
        userId: string,
        updates: Record<string, unknown>
      ) => {
        metadataCalls.push({ chatId, userId, updates });
        return Promise.resolve();
      },
    } as unknown as SessionRepositoryPort;

    const handlers = createSessionHandlers({
      chatId: session.id,
      buffer: new SessionBuffering(),
      getIsReplaying: () => false,
      sessionRuntime: runtime,
      sessionRepo: repo,
    });

    await expect(
      handlers.sessionUpdate({
        sessionId: "session-1",
        update: { sessionUpdate: "current_mode_update" } as never,
      })
    ).resolves.toBeUndefined();

    expect(session.modes?.currentModeId).toBe("mode-old");
    expect(metadataCalls).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe("serializeRawPayloadForLog", () => {
  test("redacts sensitive keys and truncates oversized arrays and strings", () => {
    const serialized = serializeRawPayloadForLog({
      sessionUpdate: "assistant_message_chunk",
      text: "secret",
      nested: {
        input: { prompt: "hidden" },
        values: Array.from({ length: 25 }, (_, index) => ({
          index,
          output: "x".repeat(300),
        })),
      },
    });

    expect(serialized).toContain('"text":"[redacted:6 chars]"');
    expect(serialized).toContain('"input":"[redacted:object]"');
    expect(serialized).toContain("[...5 more items]");
    expect(serialized).not.toContain('"output":"xxxxxxxxxx');
  });

  test("does not mark repeated references as circular when there is no cycle", () => {
    const shared = { message: "shared" };

    const serialized = serializeRawPayloadForLog({
      first: shared,
      second: shared,
    });

    expect(serialized).toContain('"first":{"message":"shared"}');
    expect(serialized).toContain('"second":{"message":"shared"}');
    expect(serialized).not.toContain("[circular]");
  });
});
