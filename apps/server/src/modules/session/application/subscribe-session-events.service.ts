import type { UIMessage } from "@repo/shared";
import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import { NotFoundError } from "@/shared/errors";
import type {
  BroadcastEvent,
  ChatSession,
  ChatStatus,
} from "@/shared/types/session.types";
import {
  cloneBroadcastEvent,
  cloneBroadcastEvents,
} from "@/shared/utils/broadcast-event.util";
import { reconcileChatStatusForSubscription } from "@/shared/utils/chat-events.util";
import { ensureUiMessagePartEventPartId } from "@/shared/utils/ui-message-part-event.util";
import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { assertSessionMutationLock } from "./session-runtime-lock.assert";

const OP = "session.events.subscribe";
const logger = createLogger("Debug");

export interface SessionEventSubscription {
  source: "runtime" | "stored";
  chatStatus: ChatStatus;
  activeTurnId?: string;
  bufferedEvents: BroadcastEvent[];
  subscribe(listener: (event: BroadcastEvent) => void): () => void;
  release(): Promise<void>;
}

export class SubscribeSessionEventsService {
  private readonly sessionRuntime: SessionRuntimePort;
  private readonly sessionRepo: SessionRepositoryPort;

  constructor(
    sessionRuntime: SessionRuntimePort,
    sessionRepo: SessionRepositoryPort
  ) {
    this.sessionRuntime = sessionRuntime;
    this.sessionRepo = sessionRepo;
  }

  async execute(
    userId: string,
    chatId: string
  ): Promise<SessionEventSubscription> {
    const sessionRuntime = this.sessionRuntime;
    const sessionRepo = this.sessionRepo;
    const pendingLiveEvents: BroadcastEvent[] = [];
    let deliveredListener: ((event: BroadcastEvent) => void) | null = null;
    let released = false;
    let stoppedSnapshot:
      | {
          chatStatus: ChatStatus;
          bufferedEvents: BroadcastEvent[];
        }
      | undefined;
    let snapshot:
      | {
          session: ChatSession;
          chatStatus: ChatStatus;
          activeTurnId?: string;
          bufferedEvents: BroadcastEvent[];
          forcedActiveSnapshot: boolean;
          subscriberCount: number;
          internalListener: (event: BroadcastEvent) => void;
        }
      | undefined;

    try {
      await sessionRuntime.runExclusive(chatId, async () => {
        assertSessionMutationLock({
          sessionRuntime,
          chatId,
          op: OP,
        });
        const session = sessionRuntime.get(chatId);
        if (!session) {
          const stored = await sessionRepo.findById(chatId, userId);
          if (!stored) {
            throw new NotFoundError("Chat not found", {
              module: "session",
              op: OP,
              details: { chatId },
            });
          }
          stoppedSnapshot = {
            chatStatus: "inactive",
            bufferedEvents: [],
          };
          return;
        }
        if (session.userId !== userId) {
          throw new NotFoundError("Chat not found", {
            module: "session",
            op: OP,
            details: { chatId },
          });
        }

        session.idleSinceAt = undefined;
        const nextChatStatus = reconcileChatStatusForSubscription(session);
        if (nextChatStatus !== session.chatStatus) {
          session.chatStatus = nextChatStatus;
        }

        const bufferedState = buildBufferedEvents(session);
        const bufferedEvents = bufferedState.events;
        const internalListener = (event: BroadcastEvent) => {
          if (released) {
            return;
          }
          const cloned = cloneBroadcastEvent(event);
          if (deliveredListener) {
            deliveredListener(cloned);
            return;
          }
          pendingLiveEvents.push(cloned);
        };
        session.emitter.on("data", internalListener);
        // Keep subscriberCount synchronized with the actual live listener
        // cardinality to avoid drift under rapid subscribe/release churn.
        session.subscriberCount = session.emitter.listenerCount("data");
        snapshot = {
          session,
          chatStatus: nextChatStatus,
          activeTurnId: session.activeTurnId,
          bufferedEvents,
          forcedActiveSnapshot: bufferedState.forcedActiveSnapshot,
          subscriberCount: session.subscriberCount,
          internalListener,
        };
      });
    } catch (error) {
      if (snapshot) {
        snapshot.session.emitter.off("data", snapshot.internalListener);
      }
      throw error;
    }

    if (stoppedSnapshot) {
      if (shouldEmitRuntimeLog("debug")) {
        logger.debug("Session event subscription prepared for stored session", {
          chatId,
          chatStatus: stoppedSnapshot.chatStatus,
          source: "stored",
        });
      }
      return {
        source: "stored" as const,
        chatStatus: stoppedSnapshot.chatStatus,
        bufferedEvents: stoppedSnapshot.bufferedEvents,
        subscribe() {
          return () => undefined;
        },
        async release() {
          return;
        },
      };
    }

    if (!snapshot) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }

    if (shouldEmitRuntimeLog("debug")) {
      logger.debug("Session event subscription prepared", {
        chatId,
        bufferedEvents: snapshot.bufferedEvents.length,
        bufferedSnapshots: countEventType(
          snapshot.bufferedEvents,
          "ui_message"
        ),
        bufferedPartUpdates: countEventType(
          snapshot.bufferedEvents,
          "ui_message_part"
        ),
        forcedActiveSnapshot: snapshot.forcedActiveSnapshot,
        subscriberCount: snapshot.subscriberCount,
        source: "runtime",
      });
    }

    const session = snapshot.session;
    const internalListener = snapshot.internalListener;
    return {
      source: "runtime" as const,
      chatStatus: snapshot.chatStatus,
      activeTurnId: snapshot.activeTurnId,
      bufferedEvents: snapshot.bufferedEvents,
      subscribe(listener) {
        const wrappedListener = (event: BroadcastEvent) => {
          if (shouldEmitRuntimeLog("debug") && shouldLogStreamEvent(event)) {
            logger.debug("Session event forwarded to subscriber", {
              chatId,
              eventType: event.type,
              ...buildStreamEventContext(event),
            });
          }
          listener(event);
        };
        deliveredListener = wrappedListener;
        if (pendingLiveEvents.length > 0) {
          const queued = pendingLiveEvents.splice(0, pendingLiveEvents.length);
          for (const event of queued) {
            wrappedListener(event);
          }
        }
        return () => {
          if (deliveredListener === wrappedListener) {
            deliveredListener = null;
          }
        };
      },
      async release() {
        if (released) {
          return;
        }
        released = true;
        deliveredListener = null;
        pendingLiveEvents.length = 0;
        session.emitter.off("data", internalListener);
        await sessionRuntime.runExclusive(chatId, async () => {
          assertSessionMutationLock({
            sessionRuntime,
            chatId,
            op: OP,
          });
          const current = sessionRuntime.get(chatId);
          if (!current || current.userId !== session.userId) {
            return;
          }
          // Only decrement when the runtime still points to the same live
          // emitter channel that this subscription incremented. This prevents
          // stale release calls from dropping subscriberCount on a newer,
          // unrelated runtime channel.
          const sameChannel =
            current === session || current.emitter === session.emitter;
          if (!sameChannel) {
            return;
          }
          current.subscriberCount = current.emitter.listenerCount("data");
          if (current.subscriberCount <= 0) {
            current.idleSinceAt = Date.now();
          }
        });
      },
    };
  }
}

function shouldLogStreamEvent(event: BroadcastEvent): boolean {
  return event.type === "ui_message" || event.type === "ui_message_part";
}

function buildStreamEventContext(
  event: BroadcastEvent
): Record<string, unknown> {
  if (event.type === "ui_message") {
    return {
      messageId: event.message.id,
      partsCount: event.message.parts.length,
    };
  }
  if (event.type === "ui_message_part") {
    return {
      messageId: event.messageId,
      partId: event.partId,
      partIndex: event.partIndex,
      isNew: event.isNew,
      partType: event.part.type,
    };
  }
  return {
    eventType: event.type,
  };
}

function countEventType(
  events: BroadcastEvent[],
  type: BroadcastEvent["type"]
): number {
  let count = 0;
  for (const event of events) {
    if (event.type === type) {
      count += 1;
    }
  }
  return count;
}

function buildBufferedEvents(session: ChatSession): {
  events: BroadcastEvent[];
  forcedActiveSnapshot: boolean;
} {
  const replayEvents = session.messageBuffer.filter((event) => {
    return event.type !== "chat_status" && event.type !== "chat_finish";
  });
  const snapshotMessages = Array.from(session.uiState.messages.values()).sort(
    (left, right) => {
      const leftCreatedAt = left.createdAt ?? 0;
      const rightCreatedAt = right.createdAt ?? 0;
      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }
      return left.id.localeCompare(right.id);
    }
  );
  const replaySnapshotMap = new Map<string, UIMessage>();
  for (const event of replayEvents) {
    if (event.type !== "ui_message") {
      continue;
    }
    replaySnapshotMap.set(event.message.id, event.message);
  }
  const effectiveSnapshots =
    snapshotMessages.length > 0
      ? snapshotMessages
      : Array.from(replaySnapshotMap.values()).sort((left, right) => {
          const leftCreatedAt = left.createdAt ?? 0;
          const rightCreatedAt = right.createdAt ?? 0;
          if (leftCreatedAt !== rightCreatedAt) {
            return leftCreatedAt - rightCreatedAt;
          }
          return left.id.localeCompare(right.id);
        });
  const snapshotEvents = effectiveSnapshots.map((message) =>
    cloneBroadcastEvent({
      type: "ui_message",
      message,
    })
  );

  const passThroughEvents = cloneBroadcastEvents(
    replayEvents.filter((event) => {
      return (
        event.type !== "ui_message" &&
        event.type !== "ui_message_part" &&
        event.type !== "ui_message_delta"
      );
    })
  );

  const activeAssistantId = session.uiState.currentAssistantId;
  const activeSnapshot = activeAssistantId
    ? effectiveSnapshots.find((message) => message.id === activeAssistantId)
    : undefined;
  const activeSnapshotPartCount = activeSnapshot?.parts.length ?? 0;
  const pendingActiveEvents = activeAssistantId
    ? replayEvents.flatMap((event) => {
        if (
          event.type !== "ui_message_part" ||
          event.messageId !== activeAssistantId
        ) {
          return [];
        }
        // Snapshot-first replay is authoritative. Re-emitting historical
        // active-turn part updates that are already represented in the
        // snapshot can regress the client UI during reconnect.
        if (activeSnapshotPartCount > 0 && event.partIndex < activeSnapshotPartCount) {
          return [];
        }
        return [
          cloneBroadcastEvent(ensureUiMessagePartEventPartId(session.id, event)),
        ];
      })
    : [];

  const hasActiveSnapshotInReplay = replayEvents.some(
    (event) =>
      event.type === "ui_message" && event.message.id === activeAssistantId
  );
  const forcedActiveSnapshot = Boolean(
    activeAssistantId &&
      session.uiState.messages.has(activeAssistantId) &&
      !hasActiveSnapshotInReplay
  );

  return {
    events: [...snapshotEvents, ...passThroughEvents, ...pendingActiveEvents],
    forcedActiveSnapshot,
  };
}
