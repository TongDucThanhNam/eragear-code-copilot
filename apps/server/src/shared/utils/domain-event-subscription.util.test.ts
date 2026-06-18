import { describe, expect, test } from "bun:test";
import type { EventBusListener, EventBusPort } from "../ports/event-bus.port";
import type { DomainEvent } from "../types/domain-events.types";
import { subscribeDomainEvents } from "./domain-event-subscription.util";

const SETTINGS_UPDATED_EVENT: DomainEvent = {
  type: "settings_updated",
  changedKeys: ["app.defaultModel"],
  requiresRestart: [],
};

const DASHBOARD_REFRESH_EVENT: DomainEvent = {
  type: "dashboard_refresh",
  reason: "settings_updated",
};

function createEventBusStub() {
  let listener: EventBusListener | undefined;
  const eventBus: EventBusPort = {
    subscribe(nextListener) {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    publish() {
      return Promise.resolve();
    },
  };
  return {
    eventBus,
    dispatch(event: DomainEvent, signal = new AbortController().signal) {
      return listener?.(event, { signal }) ?? Promise.resolve();
    },
  };
}

describe("subscribeDomainEvents", () => {
  test("filters by type and skips aborted delivery", async () => {
    const { dispatch, eventBus } = createEventBusStub();
    const delivered: string[] = [];
    subscribeDomainEvents({
      eventBus,
      types: ["settings_updated"],
      handler(event) {
        delivered.push(event.changedKeys.join(","));
      },
    });
    await dispatch(DASHBOARD_REFRESH_EVENT);
    const abort = new AbortController();
    abort.abort();
    await dispatch(SETTINGS_UPDATED_EVENT, abort.signal);
    await dispatch(SETTINGS_UPDATED_EVENT);

    expect(delivered).toEqual(["app.defaultModel"]);
  });

  test("propagates handler failures when no onError is provided", async () => {
    const { dispatch, eventBus } = createEventBusStub();
    subscribeDomainEvents({
      eventBus,
      types: ["settings_updated"],
      handler() {
        throw new Error("boom");
      },
    });

    await expect(dispatch(SETTINGS_UPDATED_EVENT)).rejects.toThrow("boom");
  });

  test("can defer handling and route failures to onError", async () => {
    const { dispatch, eventBus } = createEventBusStub();
    const delivered: string[] = [];
    const errors: string[] = [];
    subscribeDomainEvents({
      eventBus,
      types: ["settings_updated"],
      defer: true,
      handler(event) {
        delivered.push(event.type);
        throw new Error("deferred boom");
      },
      onError(error) {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });

    dispatch(SETTINGS_UPDATED_EVENT);
    expect(delivered).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(delivered).toEqual(["settings_updated"]);
    expect(errors).toEqual(["deferred boom"]);
  });

  test("applies the domain filter before deferred handling", async () => {
    const { dispatch, eventBus } = createEventBusStub();
    const delivered: string[] = [];
    subscribeDomainEvents({
      eventBus,
      types: ["settings_updated"],
      defer: true,
      filter(event) {
        return event.changedKeys.includes("app.defaultModel");
      },
      handler(event) {
        delivered.push(event.changedKeys.join(","));
      },
    });

    await dispatch({
      type: "settings_updated",
      changedKeys: ["app.theme"],
      requiresRestart: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await dispatch(SETTINGS_UPDATED_EVENT);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(delivered).toEqual(["app.defaultModel"]);
  });
});
