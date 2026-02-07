import { NotFoundError } from "@/shared/errors";
import type { BroadcastEvent, ChatStatus } from "@/shared/types/session.types";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const OP = "session.events.subscribe";

export interface SessionEventSubscription {
  chatStatus: ChatStatus;
  bufferedEvents: BroadcastEvent[];
  subscribe(listener: (event: BroadcastEvent) => void): () => void;
  release(): void;
}

export class SubscribeSessionEventsService {
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(sessionRuntime: SessionRuntimePort) {
    this.sessionRuntime = sessionRuntime;
  }

  execute(chatId: string): SessionEventSubscription {
    const session = this.sessionRuntime.get(chatId);
    if (!session) {
      throw new NotFoundError("Chat not found", {
        module: "session",
        op: OP,
        details: { chatId },
      });
    }

    session.idleSinceAt = undefined;
    session.subscriberCount += 1;

    return {
      chatStatus: session.chatStatus,
      bufferedEvents: [...session.messageBuffer],
      subscribe(listener) {
        session.emitter.on("data", listener);
        return () => {
          session.emitter.off("data", listener);
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
