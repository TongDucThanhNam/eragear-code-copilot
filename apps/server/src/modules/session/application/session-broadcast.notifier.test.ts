import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { createEventBusSessionBroadcastNotifier } from "./session-broadcast.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("SessionBroadcastNotifier", () => {
  test("publishes session broadcast events", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusSessionBroadcastNotifier(
      createEventBusStub(events)
    );

    await notifier.broadcast({
      chatId: "chat-1",
      userId: "user-1",
      event: {
        type: "error",
        error: "hello",
      },
    });

    expect(events).toEqual([
      {
        type: "session_broadcast",
        chatId: "chat-1",
        userId: "user-1",
        event: {
          type: "error",
          error: "hello",
        },
      },
    ]);
  });
});
