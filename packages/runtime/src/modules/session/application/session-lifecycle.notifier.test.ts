import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { createEventBusSessionLifecycleNotifier } from "./session-lifecycle.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("SessionLifecycleNotifier", () => {
  test("publishes agent session lifecycle and dashboard events", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusSessionLifecycleNotifier(
      createEventBusStub(events)
    );

    await notifier.agentSessionCreated({
      userId: "user-1",
      projectRoot: "/repo/project",
      projectId: "project-1",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
    });
    await notifier.agentSessionStopped({
      userId: "user-1",
      projectRoot: "/repo/project",
      projectId: "project-1",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
      stopReason: "user_requested",
    });
    await notifier.sessionDeleted({
      userId: "user-1",
      chatId: "chat-1",
    });

    expect(events).toEqual([
      {
        type: "agent_session_created",
        userId: "user-1",
        projectRoot: "/repo/project",
        projectId: "project-1",
        chatId: "chat-1",
        agentSessionId: "agent-session-1",
      },
      {
        type: "agent_session_stopped",
        userId: "user-1",
        projectRoot: "/repo/project",
        projectId: "project-1",
        chatId: "chat-1",
        agentSessionId: "agent-session-1",
        stopReason: "user_requested",
      },
      {
        type: "dashboard_refresh",
        reason: "session_stopped",
        userId: "user-1",
        chatId: "chat-1",
      },
      {
        type: "dashboard_refresh",
        reason: "session_deleted",
        userId: "user-1",
        chatId: "chat-1",
      },
    ]);
  });
});
