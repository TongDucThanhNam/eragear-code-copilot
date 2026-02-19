import { describe, expect, test } from "bun:test";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { createSessionUpdateHandler, SessionBuffering } from "./update";
import { parseSessionUpdatePayload } from "./update-schema";

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
      availableModes: [
        {
          id: "mode-old",
          name: "Old",
        },
      ],
    },
  } satisfies Partial<ChatSession> as ChatSession;
}

function createRuntime(session: ChatSession) {
  const events: unknown[] = [];
  const runtime = {
    get(chatId: string) {
      return chatId === session.id ? session : undefined;
    },
    broadcast(_chatId: string, event: unknown) {
      events.push(event);
      return Promise.resolve();
    },
    async runExclusive<T>(_chatId: string, work: () => Promise<T>): Promise<T> {
      return await work();
    },
  } as unknown as SessionRuntimePort;
  return { runtime, events };
}

function createRepo() {
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
  return { repo, metadataCalls };
}

describe("createSessionUpdateHandler", () => {
  test("applies current_mode_update and persists metadata", async () => {
    const session = createSession("chat-mode");
    const { runtime, events } = createRuntime(session);
    const { repo, metadataCalls } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: "mode-new",
      },
    });

    expect(session.modes?.currentModeId).toBe("mode-new");
    expect(metadataCalls).toEqual([
      {
        chatId: "chat-mode",
        userId: "user-1",
        updates: { modeId: "mode-new" },
      },
    ]);
    expect(events).toContainEqual({
      type: "current_mode_update",
      modeId: "mode-new",
    });
  });

  test("applies available_commands_update and persists metadata", async () => {
    const session = createSession("chat-commands");
    const { runtime, events } = createRuntime(session);
    const { repo, metadataCalls } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "lint",
            description: "Run linter",
          },
        ],
      },
    });

    expect(session.commands).toEqual([
      {
        name: "lint",
        description: "Run linter",
      },
    ]);
    expect(metadataCalls).toEqual([
      {
        chatId: "chat-commands",
        userId: "user-1",
        updates: {
          commands: [{ name: "lint", description: "Run linter" }],
        },
      },
    ]);
    expect(events).toContainEqual({
      type: "available_commands_update",
      availableCommands: [{ name: "lint", description: "Run linter" }],
    });
  });

  test("ignores unhandled updates without crashing", async () => {
    const session = createSession("chat-unhandled");
    const { runtime, events } = createRuntime(session);
    const { repo, metadataCalls } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await expect(
      handler({
        chatId: session.id,
        buffer: new SessionBuffering(),
        isReplayingHistory: false,
        update: {
          sessionUpdate: "session_info_update",
          title: "noop",
        },
      })
    ).resolves.toBeUndefined();

    expect(metadataCalls).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test("drops invalid update payloads before pipeline mutation", async () => {
    const session = createSession("chat-invalid");
    const { runtime, events } = createRuntime(session);
    const { repo, metadataCalls } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    const invalidRawUpdate: unknown = {
      sessionUpdate: "current_mode_update",
      // missing required currentModeId string
    };
    const parsed = parseSessionUpdatePayload(invalidRawUpdate);
    expect(parsed).toBeNull();

    if (parsed) {
      await handler({
        chatId: session.id,
        buffer: new SessionBuffering(),
        isReplayingHistory: false,
        update: parsed,
      });
    }

    expect(session.modes?.currentModeId).toBe("mode-old");
    expect(metadataCalls).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test("keeps replay update pipeline active while suppressing replay broadcasts", async () => {
    const session = createSession("chat-replay-suppressed");
    session.suppressReplayBroadcast = true;
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: true,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Replay text" },
      },
    });

    expect(events).toHaveLength(0);
    const assistantId = session.uiState.currentAssistantId;
    expect(assistantId).toBeDefined();
    const replayMessage = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    expect(replayMessage).toBeDefined();
    const textPart = replayMessage?.parts.find((part) => part.type === "text");
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe("Replay text");
      expect(textPart.state).toBe("done");
    }
  });

  test("does not mark chat as streaming when no active turn is present", async () => {
    const session = createSession("chat-no-active-turn");
    session.chatStatus = "ready";
    session.activeTurnId = undefined;
    session.activePromptTask = undefined;
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late chunk" },
      },
    });

    expect(session.chatStatus).toBe("ready");
    const statusEvents = events.filter(
      (event): event is { type: "chat_status"; status: string } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type?: string }).type === "chat_status"
    );
    expect(statusEvents).toHaveLength(0);
  });
});
