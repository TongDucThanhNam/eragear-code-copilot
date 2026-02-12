import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "../types/domain-events.types";
import { EventBus } from "./event-bus";

const DASHBOARD_REFRESH_EVENT: DomainEvent = {
  type: "dashboard_refresh",
  reason: "settings_updated",
};

describe("EventBus.publish", () => {
  test("continues notifying later listeners when one listener fails", async () => {
    const delivery: string[] = [];
    const logs: Array<{ message: string; context?: Record<string, unknown> }> =
      [];
    const bus = new EventBus({
      error(message, context) {
        logs.push({ message, context });
      },
    });

    bus.subscribe(() => {
      delivery.push("listener-1");
      throw new Error("listener failed");
    });
    bus.subscribe(() => {
      delivery.push("listener-2");
    });

    await bus.publish(DASHBOARD_REFRESH_EVENT);

    expect(delivery).toEqual(["listener-1", "listener-2"]);
    expect(logs.length).toBe(2);
    expect(logs[0]?.message).toBe("[EventBus] Listener error");
    expect(logs[1]?.message).toBe(
      "[EventBus] Publish completed with listener failures"
    );
  });
});
