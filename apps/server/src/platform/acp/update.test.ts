import { afterEach, describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import {
  getTurnIdMigrationSnapshot,
  resetTurnIdMigrationSnapshotForTests,
} from "./turn-id-observability";
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

function createLockedRuntime(session: ChatSession) {
  const events: unknown[] = [];
  let tail = Promise.resolve();
  const runtime = {
    get(chatId: string) {
      return chatId === session.id ? session : undefined;
    },
    broadcast(_chatId: string, event: unknown) {
      events.push(event);
      return Promise.resolve();
    },
    async runExclusive<T>(_chatId: string, work: () => Promise<T>): Promise<T> {
      const run = tail.then(() => work());
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return await run;
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
  afterEach(() => {
    ENV.acpTurnIdPolicy = "compat";
    resetTurnIdMigrationSnapshotForTests();
  });

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
        reason: "agent_exit_plan_mode",
        metadata: { source: "tool_call", toolCallId: "tool-1" },
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
      reason: "agent_exit_plan_mode",
      metadata: { source: "tool_call", toolCallId: "tool-1" },
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

  test("applies config_option_update and syncs legacy mode/model metadata", async () => {
    const session = createSession("chat-config-options");
    session.models = {
      currentModelId: "model-old",
      availableModels: [{ modelId: "model-old", name: "Old model" }],
    };
    const { runtime, events } = createRuntime(session);
    const { repo, metadataCalls } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: "mode-new",
            options: [{ value: "mode-new", name: "New mode" }],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "model-new",
            options: [{ value: "model-new", name: "New model" }],
          },
        ],
      },
    });

    expect(session.configOptions).toHaveLength(2);
    expect(session.modes?.currentModeId).toBe("mode-new");
    expect(session.models?.currentModelId).toBe("model-new");
    expect(metadataCalls).toContainEqual({
      chatId: "chat-config-options",
      userId: "user-1",
      updates: {
        modeId: "mode-new",
        modelId: "model-new",
      },
    });
    expect(events).toContainEqual({
      type: "config_options_update",
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          currentValue: "mode-new",
          options: [{ value: "mode-new", name: "New mode" }],
        },
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "model-new",
          options: [{ value: "model-new", name: "New model" }],
        },
      ],
    });
    expect(events).toContainEqual({
      type: "current_mode_update",
      modeId: "mode-new",
      reason: "config_option_update",
      metadata: {
        source: "config_option_update",
        configId: "mode",
      },
    });
  });

  test("applies session_info_update and broadcasts metadata update", async () => {
    const session = createSession("chat-session-info");
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
          title: "ACP title",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      })
    ).resolves.toBeUndefined();

    expect(session.sessionInfo).toEqual({
      title: "ACP title",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(metadataCalls).toHaveLength(0);
    expect(events).toContainEqual({
      type: "session_info_update",
      sessionInfo: {
        title: "ACP title",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    });
  });

  test("ignores unsupported updates without crashing", async () => {
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
          sessionUpdate: "usage_update",
          _meta: {},
        } as never,
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

  test("accepts current_mode_update payload with modeId alias", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "current_mode_update",
      modeId: "mode-from-alias",
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "current_mode_update",
        currentModeId: "mode-from-alias",
      })
    );
  });

  test("normalizes config_options_update alias to config_option_update", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "config_options_update",
      configOptions: [
        {
          id: "mode",
          name: "Mode",
          type: "select",
          currentValue: "code",
          options: [{ value: "code", name: "Code" }],
        },
      ],
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "config_option_update",
      })
    );
  });

  test("accepts tool_call payload when kind is omitted", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read settings",
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
      })
    );
  });

  test("accepts tool_call_update payload when status is omitted", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: "still running",
          },
        },
      ],
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
      })
    );
  });

  test("normalizes assistant_reasoning_chunk alias to agent_thought_chunk", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "assistant_reasoning_chunk",
      content: { type: "text", text: "thinking" },
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "agent_thought_chunk",
      })
    );
  });

  test("normalizes wrapped content blocks in chunk updates", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "content",
        content: {
          type: "text",
          text: "wrapped text",
        },
      },
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        content: expect.objectContaining({
          type: "text",
          text: "wrapped text",
        }),
      })
    );
  });

  test("normalizes text_delta chunk payloads to text blocks", () => {
    const parsed = parseSessionUpdatePayload({
      sessionUpdate: "assistant_text_chunk",
      content: {
        type: "text_delta",
        delta: "delta text",
      },
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        content: expect.objectContaining({
          type: "text",
          text: "delta text",
        }),
      })
    );
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

  test("serializes concurrent stream chunk updates without content loss", async () => {
    const session = createSession("chat-stream-concurrent");
    const { runtime } = createLockedRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);
    const buffer = new SessionBuffering();
    const chunks = Array.from({ length: 64 }, () => "x");

    await Promise.all(
      chunks.map((text) =>
        handler({
          chatId: session.id,
          buffer,
          isReplayingHistory: false,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        })
      )
    );

    const assistantId = session.uiState.currentAssistantId;
    expect(assistantId).toBeDefined();
    const assistantMessage = assistantId
      ? session.uiState.messages.get(assistantId)
      : undefined;
    const textPart = assistantMessage?.parts.find(
      (part) => part.type === "text"
    );
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.text).toBe(chunks.join(""));
    }
  });

  test("hydrates tool state from update-only flow and preserves raw IO fields", async () => {
    const session = createSession("chat-tool-update-only");
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);
    const buffer = new SessionBuffering();

    await handler({
      chatId: session.id,
      buffer,
      isReplayingHistory: false,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        kind: "execute",
        title: "Run command",
        status: "in_progress",
        rawInput: { command: "ls -la" },
      },
    });

    await handler({
      chatId: session.id,
      buffer,
      isReplayingHistory: false,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "failed",
        rawOutput: { error: "permission denied" },
      },
    });

    const storedToolCall = session.toolCalls.get("tool-1");
    expect(storedToolCall).toBeDefined();
    expect(storedToolCall?.kind).toBe("execute");
    expect(storedToolCall?.rawInput).toEqual({ command: "ls -la" });
    expect(storedToolCall?.rawOutput).toEqual({
      error: "permission denied",
    });

    const uiMessagePartEvents = events.filter((event) => {
      return (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type?: string }).type === "ui_message_part"
      );
    });
    expect(uiMessagePartEvents.length).toBeGreaterThan(0);
    const lastPartEvent = uiMessagePartEvents.at(-1) as {
      type: "ui_message_part";
      messageId: string;
      part: {
        type: string;
        toolCallId?: string;
        state?: string;
        errorText?: string;
      };
      partIndex: number;
    };
    expect(lastPartEvent.part).toMatchObject({
      toolCallId: "tool-1",
      state: "output-error",
      errorText: "permission denied",
    });
  });

  test("flushes pending assistant part broadcasts before replay user snapshots", async () => {
    const session = createSession("chat-replay-ordering");
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);
    const buffer = new SessionBuffering();

    await handler({
      chatId: session.id,
      buffer,
      isReplayingHistory: true,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    });

    await handler({
      chatId: session.id,
      buffer,
      isReplayingHistory: true,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " world" },
      },
    });

    await handler({
      chatId: session.id,
      buffer,
      isReplayingHistory: true,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "next question" },
      },
    });

    const flushedPartIndex = events.findIndex((event) => {
      return (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type?: string }).type === "ui_message_part" &&
        "part" in event &&
        (event as { part?: { type?: string; text?: string } }).part?.type ===
          "text" &&
        (
          event as { part?: { type?: string; text?: string } }
        ).part?.text === "Hello world"
      );
    });
    const snapshotIndex = events.findIndex((event) => {
      return (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type?: string }).type === "ui_message"
      );
    });

    expect(flushedPartIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeGreaterThan(flushedPartIndex);
  });

  test("sanitizes tool locations before storing and broadcasting them", async () => {
    const session = createSession("chat-tool-locations");
    session.projectRoot = process.cwd();
    session.cwd = process.cwd();
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        kind: "read",
        title: "Read project file",
        locations: [
          {
            path: "apps/server/src/platform/acp/update.ts",
            line: 12,
          },
          {
            path: "/etc/shadow",
            line: 1,
          },
        ],
      } as never,
    });

    expect(session.toolCalls.get("tool-1")?.locations).toEqual([
      {
        path: "apps/server/src/platform/acp/update.ts",
        line: 12,
      },
    ]);

    const locationEvent = events.find((event) => {
      return (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type?: string }).type === "ui_message_part" &&
        "part" in event &&
        (event as { part?: { type?: string } }).part?.type ===
          "data-tool-locations"
      );
    }) as
      | {
          type: "ui_message_part";
          part: {
            type: "data-tool-locations";
            data: {
              toolCallId: string;
              locations: Array<{ path: string; line?: number }>;
            };
          };
        }
      | undefined;

    expect(locationEvent?.part.data).toEqual({
      toolCallId: "tool-1",
      locations: [
        {
          path: "apps/server/src/platform/acp/update.ts",
          line: 12,
        },
      ],
    });
  });

  test("broadcasts ui_message_part_removed when tool locations are deleted", async () => {
    const session = createSession("chat-tool-locations-delete");
    session.projectRoot = process.cwd();
    session.cwd = process.cwd();
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        kind: "read",
        title: "Read project file",
        locations: [
          {
            path: "apps/server/src/platform/acp/update.ts",
            line: 12,
          },
        ],
      } as never,
    });

    events.length = 0;

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        locations: null,
      } as never,
    });

    const removedEvent = events.find((event) => {
      return (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type?: string }).type === "ui_message_part_removed"
      );
    }) as
      | {
          type: "ui_message_part_removed";
          partId?: string;
          partIndex: number;
          part: {
            type: "data-tool-locations";
            data: {
              toolCallId: string;
              locations: Array<{ path: string; line?: number }>;
            };
          };
        }
      | undefined;

    expect(removedEvent).toBeDefined();
    expect(removedEvent?.part.type).toBe("data-tool-locations");
    expect(removedEvent?.part.data.toolCallId).toBe("tool-1");
    expect(removedEvent?.partIndex).toBeGreaterThanOrEqual(0);
    expect(session.uiState.messages.get(session.uiState.currentAssistantId ?? "")?.parts)
      .not.toContainEqual(
        expect.objectContaining({
          type: "data-tool-locations",
        })
      );
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

  test("ignores stale tool updates that target a different turn", async () => {
    const session = createSession("chat-stale-tool-turn");
    session.activeTurnId = "turn-live";
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "in_progress",
        _meta: { turnId: "turn-stale" },
      },
    });

    expect(session.toolCalls.size).toBe(0);
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "ui_message_part",
      })
    );
    expect(getTurnIdMigrationSnapshot().drops.staleTurnMismatch).toBe(1);
  });

  test("ignores stale assistant chunks that target a different turn", async () => {
    const session = createSession("chat-stale-assistant-turn");
    session.activeTurnId = "turn-live";
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "agent_message_chunk",
        turnId: "turn-stale",
        content: { type: "text", text: "late chunk" },
      } as never,
    });

    expect(session.uiState.currentAssistantId).toBeUndefined();
    expect(session.uiState.messages.size).toBe(0);
    expect(events).toHaveLength(0);
    expect(getTurnIdMigrationSnapshot().drops.staleTurnMismatch).toBe(1);
  });

  test("drops turn-scoped live updates without native turnId under strict policy", async () => {
    ENV.acpTurnIdPolicy = "require-native";
    const session = createSession("chat-strict-turn-policy");
    session.activeTurnId = "turn-live";
    const { runtime, events } = createRuntime(session);
    const { repo } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "agent_message_chunk",
        _meta: { turnId: "turn-live" },
        content: { type: "text", text: "hello" },
      } as never,
    });

    expect(session.uiState.messages.size).toBe(0);
    expect(events).toHaveLength(0);
    expect(getTurnIdMigrationSnapshot()).toEqual(
      expect.objectContaining({
        sessionUpdates: {
          native: 0,
          metaFallback: 1,
          missing: 0,
        },
        drops: expect.objectContaining({
          requireNativePolicy: 1,
        }),
      })
    );
  });

  test("syncs mode/model from config options when legacy state is absent", async () => {
    const session = createSession("chat-config-fallback");
    session.modes = undefined;
    session.models = undefined;
    const { runtime, events } = createRuntime(session);
    const { repo, metadataCalls } = createRepo();
    const handler = createSessionUpdateHandler(runtime, repo);

    await handler({
      chatId: session.id,
      buffer: new SessionBuffering(),
      isReplayingHistory: false,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            type: "select",
            currentValue: "architect",
            options: [{ value: "architect", name: "Architect" }],
          },
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "claude-sonnet",
            options: [{ value: "claude-sonnet", name: "Claude Sonnet" }],
          },
        ],
      },
    });

    expect(session.modes).toBeDefined();
    if (!session.modes) {
      throw new Error("Expected modes to be derived from config options");
    }
    expect(session.modes as unknown).toEqual({
      currentModeId: "architect",
      availableModes: [{ id: "architect", name: "Architect" }],
    });
    expect(session.models).toBeDefined();
    if (!session.models) {
      throw new Error("Expected models to be derived from config options");
    }
    expect(session.models as unknown).toEqual({
      currentModelId: "claude-sonnet",
      availableModels: [{ modelId: "claude-sonnet", name: "Claude Sonnet" }],
    });
    expect(metadataCalls).toContainEqual({
      chatId: "chat-config-fallback",
      userId: "user-1",
      updates: {
        modeId: "architect",
        modelId: "claude-sonnet",
      },
    });
    expect(events).toContainEqual({
      type: "current_mode_update",
      modeId: "architect",
      reason: "config_option_update",
      metadata: {
        source: "config_option_update",
        configId: "mode",
      },
    });
    expect(events).toContainEqual({
      type: "current_model_update",
      modelId: "claude-sonnet",
    });
  });
});
