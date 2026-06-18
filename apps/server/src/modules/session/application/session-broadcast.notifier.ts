import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { BroadcastEvent } from "@/shared/types/session.types";

export interface SessionBroadcastNotification {
  chatId: string;
  userId: string;
  event: BroadcastEvent;
}

export interface SessionBroadcastNotifier {
  broadcast(input: SessionBroadcastNotification): Promise<void>;
}

export function createEventBusSessionBroadcastNotifier(
  eventBus: EventBusPort
): SessionBroadcastNotifier {
  return {
    async broadcast(input) {
      await eventBus.publish({
        type: "session_broadcast",
        chatId: input.chatId,
        userId: input.userId,
        event: input.event,
      });
    },
  };
}

export const noopSessionBroadcastNotifier: SessionBroadcastNotifier = {
  broadcast: () => Promise.resolve(),
};
