import { shouldEmitRuntimeLog } from "@/platform/logging/runtime-log-level";
import { createLogger } from "@/platform/logging/structured-logger";
import { NotFoundError } from "@/shared/errors";
import type {
  BroadcastEvent,
  ChatSession,
  ChatStatus,
} from "@/shared/types/session.types";
import { reconcileChatStatusForSubscription } from "@/shared/utils/chat-events.util";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.events.subscribe";
const logger = createLogger("Debug");

export interface SessionEventSubscription {
  chatStatus: ChatStatus;
  activeTurnId?: string;
  bufferedEvents: BroadcastEvent[];
  subscribe(listener: (event: BroadcastEvent) => void): () => void;
  release(): void;
}

export class SubscribeSessionEventsService {
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  execute(userId: string, chatId: string): SessionEventSubscription {
    const session = this.sessionRuntime.get(chatId);
    if (!session || session.userId !== userId) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }

    session.idleSinceAt = undefined;
    session.subscriberCount += 1;
    const chatStatus = reconcileChatStatusForSubscription(session);
    const bufferedState = buildBufferedEvents(session);
    const bufferedEvents = bufferedState.events;
    if (shouldEmitRuntimeLog("debug")) {
      logger.debug("Session event subscription prepared", {
        chatId,
        bufferedEvents: bufferedEvents.length,
        bufferedSnapshots: countEventType(bufferedEvents, "ui_message"),
        bufferedDeltas: countEventType(bufferedEvents, "ui_message_delta"),
        forcedActiveSnapshot: bufferedState.forcedActiveSnapshot,
        subscriberCount: session.subscriberCount,
      });
    }

    return {
      chatStatus,
      activeTurnId: session.activeTurnId,
      bufferedEvents,
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
        session.emitter.on("data", wrappedListener);
        return () => {
          session.emitter.off("data", wrappedListener);
        };
      },
      release() {
        session.subscriberCount = Math.max(0, session.subscriberCount - 1);
        if (session.subscriberCount <= 0) {
          session.idleSinceAt = Date.now();
        }
      },
    };
  }
}

function shouldLogStreamEvent(event: BroadcastEvent): boolean {
  return event.type === "ui_message" || event.type === "ui_message_delta";
}

function buildStreamEventContext(event: BroadcastEvent): Record<string, unknown> {
  if (event.type === "ui_message") {
    return {
      messageId: event.message.id,
      partsCount: event.message.parts.length,
    };
  }
  if (event.type === "ui_message_delta") {
    return {
      messageId: event.messageId,
      partType: event.partType,
      deltaLength: event.delta.length,
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
  const bufferedEvents = [...session.messageBuffer];
  const activeAssistantId = session.uiState.currentAssistantId;
  if (!activeAssistantId) {
    return {
      events: bufferedEvents,
      forcedActiveSnapshot: false,
    };
  }
  const activeAssistantMessage = session.uiState.messages.get(activeAssistantId);
  if (!activeAssistantMessage) {
    return {
      events: bufferedEvents,
      forcedActiveSnapshot: false,
    };
  }
  const hasSnapshotInBuffer = bufferedEvents.some(
    (event) =>
      event.type === "ui_message" && event.message.id === activeAssistantId
  );
  let forcedActiveSnapshot = false;
  if (!hasSnapshotInBuffer) {
    bufferedEvents.push({
      type: "ui_message",
      message: activeAssistantMessage,
    });
    forcedActiveSnapshot = true;
  }
  return {
    events: bufferedEvents,
    forcedActiveSnapshot,
  };
}
