import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import {
  createEventBusSettingsChangeNotifier,
  noopSettingsChangeNotifier,
} from "./settings-change.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("SettingsChangeNotifier", () => {
  test("publishes settings update and dashboard refresh events", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusSettingsChangeNotifier(
      createEventBusStub(events)
    );

    await notifier.publishSettingsChanged({
      changedKeys: ["app.defaultModel"],
      requiresRestart: [],
    });

    expect(events).toEqual([
      {
        type: "settings_updated",
        changedKeys: ["app.defaultModel"],
        requiresRestart: [],
      },
      {
        type: "dashboard_refresh",
        reason: "settings_updated",
      },
    ]);
  });

  test("supports a noop adapter for optional settings mutation paths", async () => {
    await expect(
      noopSettingsChangeNotifier.publishSettingsChanged({
        changedKeys: ["app.defaultModel"],
        requiresRestart: [],
      })
    ).resolves.toBeUndefined();
  });
});
