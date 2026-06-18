import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { createEventBusAgentLifecycleNotifier } from "./agent-lifecycle.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("AgentLifecycleNotifier", () => {
  test("publishes dashboard refresh events for agent mutations", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusAgentLifecycleNotifier(
      createEventBusStub(events)
    );

    await notifier.agentCreated({ userId: "user-1", agentId: "agent-1" });
    await notifier.agentUpdated({ userId: "user-1", agentId: "agent-1" });
    await notifier.agentDeleted({ userId: "user-1", agentId: "agent-1" });

    expect(events).toEqual([
      {
        type: "dashboard_refresh",
        reason: "agent_created",
        userId: "user-1",
        agentId: "agent-1",
      },
      {
        type: "dashboard_refresh",
        reason: "agent_updated",
        userId: "user-1",
        agentId: "agent-1",
      },
      {
        type: "dashboard_refresh",
        reason: "agent_deleted",
        userId: "user-1",
        agentId: "agent-1",
      },
    ]);
  });
});
