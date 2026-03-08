import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "../types/domain-events.types";
import { EventBus } from "./event-bus";

const DASHBOARD_REFRESH_EVENT: DomainEvent = {
  type: "dashboard_refresh",
  reason: "settings_updated",
};

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
    expect(logs[0]?.context?.errorStack).toContain("listener failed");
    expect(logs[1]?.message).toBe(
      "[EventBus] Publish completed with listener failures"
    );
  });

  test("does not block fast listeners behind a slow listener", async () => {
    const bus = new EventBus();
    const slowRelease = createDeferred();
    const delivery: string[] = [];

    bus.subscribe(async () => {
      delivery.push("slow:start");
      await slowRelease.promise;
      delivery.push("slow:end");
    });
    bus.subscribe(() => {
      delivery.push("fast");
    });

    const publishPromise = bus.publish(DASHBOARD_REFRESH_EVENT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(delivery).toEqual(["slow:start", "fast"]);

    slowRelease.resolve();
    await publishPromise;
    expect(delivery).toEqual(["slow:start", "fast", "slow:end"]);
  });

  test("times out slow listeners and still returns from publish", async () => {
    const logs: Array<{ message: string; context?: Record<string, unknown> }> =
      [];
    const bus = new EventBus(
      {
        error(message, context) {
          logs.push({ message, context });
        },
      },
      { listenerTimeoutMs: 10 }
    );

    bus.subscribe(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await expect(bus.publish(DASHBOARD_REFRESH_EVENT)).resolves.toBeUndefined();
    expect(
      logs.some((entry) => entry.message === "[EventBus] Listener error")
    ).toBe(true);
  });
});
