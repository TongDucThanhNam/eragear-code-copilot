import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  findPendingPermission,
  processSessionEvent,
  type BroadcastEvent,
  type ChatStatus,
  type ConnectionStatus,
  type PermissionRequest,
  type UIMessage,
} from "@repo/shared";
import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import { SubscribeSessionEventsService } from "@/modules/session/application/subscribe-session-events.service";
import type { SessionEventOutboxPort } from "@/modules/session/application/ports/session-event-outbox.port";
import { SessionRuntimeStore } from "@/modules/session/infra/runtime-store";
import type { ChatSession } from "@/shared/types/session.types";
import { createUiMessageState } from "@/shared/utils/ui-message.util";
import { scheduleThrottledBroadcast } from "./broadcast-throttle";
import { createPermissionHandler } from "./permission";

function createOutboxStub(): SessionEventOutboxPort {
  return {
    enqueue: async () => undefined,
    dispatch: async () => ({
      dispatched: 0,
      failed: 0,
      retried: 0,
      pending: 0,
    }),
  };
}

function createSessionRepo(): SessionRepositoryPort {
  return {
    findById: async () => undefined,
  } as unknown as SessionRepositoryPort;
}

function createSession(chatId: string, message?: UIMessage): ChatSession {
  const uiState = createUiMessageState();
  if (message) {
    uiState.messages.set(message.id, message);
    uiState.currentAssistantId = message.id;
    uiState.lastAssistantId = message.id;
  }
  return {
    id: chatId,
    userId: "user-1",
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
    uiState,
    chatStatus: "ready",
  };
}

interface ClientHarness {
  status: ChatStatus;
  connStatus: ConnectionStatus;
  messages: UIMessage[];
  pendingPermission: PermissionRequest | null;
}

function createClientHarness(): ClientHarness {
  return {
    status: "connecting",
    connStatus: "connecting",
    messages: [],
    pendingPermission: null,
  };
}

function applyClientEvent(
  current: ClientHarness,
  event: BroadcastEvent
): ClientHarness {
  const orderedMessages = [...current.messages];
  const byId = new Map(
    orderedMessages.map((message) => [message.id, message] as const)
  );
  const next: ClientHarness = {
    ...current,
    messages: orderedMessages,
  };

  processSessionEvent(
    event,
    {
      currentModes: null,
      currentModels: null,
    },
    {
      onStatusChange: (status) => {
        next.status = status;
      },
      onConnStatusChange: (connStatus) => {
        next.connStatus = connStatus;
      },
      onMessageUpsert: (message) => {
        const existingIndex = orderedMessages.findIndex(
          (currentMessage) => currentMessage.id === message.id
        );
        if (existingIndex >= 0) {
          orderedMessages[existingIndex] = message;
        } else {
          orderedMessages.push(message);
        }
        byId.set(message.id, message);
      },
      getMessageById: (messageId) => byId.get(messageId),
      getMessagesForPermission: () => orderedMessages,
      onPendingPermissionChange: (permission) => {
        next.pendingPermission = permission;
      },
    }
  );
  next.pendingPermission ??= findPendingPermission(orderedMessages);

  return next;
}

function applySubscriptionBootstrap(
  current: ClientHarness,
  subscription: Awaited<ReturnType<SubscribeSessionEventsService["execute"]>>
): ClientHarness {
  let next = current;
  if (subscription.source === "runtime") {
    next = applyClientEvent(next, { type: "connected" });
  }
  next = applyClientEvent(next, {
    type: "chat_status",
    status: subscription.chatStatus,
    ...(subscription.activeTurnId ? { turnId: subscription.activeTurnId } : {}),
  });
  for (const event of subscription.bufferedEvents) {
    next = applyClientEvent(next, event);
  }
  return next;
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("permission flow e2e", () => {
  test("live permission request reaches client pendingPermission without refresh", async () => {
    const chatId = "chat-live-permission";
    const assistantMessage: UIMessage = {
      id: "msg-live",
      role: "assistant",
      parts: [{ type: "text", text: "thinking", state: "streaming" }],
    };
    const runtime = new SessionRuntimeStore(createOutboxStub(), {
      sessionBufferLimit: 50,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 8,
    });
    runtime.set(chatId, createSession(chatId, assistantMessage));
    const subscriptionService = new SubscribeSessionEventsService(
      runtime,
      createSessionRepo()
    );
    const subscription = await subscriptionService.execute("user-1", chatId);

    let client = applySubscriptionBootstrap(createClientHarness(), subscription);
    const liveEvents: BroadcastEvent[] = [];
    const unsubscribe = subscription.subscribe((event) => {
      liveEvents.push(event);
      client = applyClientEvent(client, event);
    });

    scheduleThrottledBroadcast({
      chatId,
      messageId: assistantMessage.id,
      partIndex: 0,
      isNew: true,
      sessionRuntime: runtime,
      event: {
        type: "ui_message_part",
        messageId: assistantMessage.id,
        messageRole: "assistant",
        partIndex: 0,
        part: { type: "text", text: "thinking harder", state: "streaming" },
        isNew: true,
      },
      options: {
        durable: false,
        retainInBuffer: true,
      },
    });

    const handler = createPermissionHandler(runtime);
    const responsePromise = handler({
      chatId,
      isReplayingHistory: false,
      request: {
        sessionId: "session-live",
        toolCall: {
          toolCallId: "tool-live",
          kind: "execute",
          title: "Run command",
          rawInput: { command: "ls -la" },
        },
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
          { optionId: "reject_once", kind: "reject_once", name: "Reject" },
        ],
      },
    });

    await flushAsync();

    expect(client.status).toBe("awaiting_permission");
    expect(client.pendingPermission).toMatchObject({
      toolCallId: "tool-live",
      title: "Run command",
      input: { command: "ls -la" },
    });
    expect(liveEvents.map((event) => event.type)).toEqual([
      "ui_message_part",
      "chat_status",
      "ui_message_part",
      "ui_message_part",
    ]);

    const session = runtime.get(chatId);
    const pendingEntry = session
      ? Array.from(session.pendingPermissions.values())[0]
      : undefined;
    if (!pendingEntry) {
      throw new Error("Expected pending permission entry");
    }
    pendingEntry.resolve({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });

    unsubscribe();
    await subscription.release();
  });

  test("late subscriber reconstructs pendingPermission from buffered runtime snapshot", async () => {
    const chatId = "chat-buffered-permission";
    const assistantMessage: UIMessage = {
      id: "msg-buffered",
      role: "assistant",
      parts: [{ type: "text", text: "waiting", state: "done" }],
    };
    const runtime = new SessionRuntimeStore(createOutboxStub(), {
      sessionBufferLimit: 50,
      lockAcquireTimeoutMs: 500,
      eventBusPublishMaxQueuePerChat: 8,
    });
    runtime.set(chatId, createSession(chatId, assistantMessage));
    const handler = createPermissionHandler(runtime);

    const responsePromise = handler({
      chatId,
      isReplayingHistory: false,
      request: {
        sessionId: "session-buffered",
        toolCall: {
          toolCallId: "tool-buffered",
          kind: "execute",
          title: "Run command",
          rawInput: { command: "pwd" },
        },
        options: [
          { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
        ],
      },
    });

    await flushAsync();

    const subscriptionService = new SubscribeSessionEventsService(
      runtime,
      createSessionRepo()
    );
    const subscription = await subscriptionService.execute("user-1", chatId);
    const client = applySubscriptionBootstrap(createClientHarness(), subscription);

    expect(client.status).toBe("awaiting_permission");
    expect(client.pendingPermission).toMatchObject({
      toolCallId: "tool-buffered",
      title: "Run command",
      input: { command: "pwd" },
    });
    expect(
      client.messages
        .find((message) => message.id === assistantMessage.id)
        ?.parts.some(
        (part) => part.type === "data-permission-options"
      )
    ).toBe(true);

    const session = runtime.get(chatId);
    const pendingEntry = session
      ? Array.from(session.pendingPermissions.values())[0]
      : undefined;
    if (!pendingEntry) {
      throw new Error("Expected pending permission entry");
    }
    pendingEntry.resolve({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });

    await subscription.release();
  });
});
