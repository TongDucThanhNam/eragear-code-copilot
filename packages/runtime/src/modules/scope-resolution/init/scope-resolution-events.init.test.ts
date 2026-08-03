import { describe, expect, test } from "bun:test";
import type { ScopeResolutionUseCases } from "#runtime/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeScopeResolutionEvents } from "./scope-resolution-events.init";

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
    dispatch(event: DomainEvent) {
      return listener?.(event, { signal: new AbortController().signal });
    },
  };
}

describe("initializeScopeResolutionEvents", () => {
  test("invalidates import graph state when watched project files change", async () => {
    const invalidations: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const scopeResolutionUseCases = {
      scopeResolver: {
        invalidateImportGraphFile(input: unknown) {
          invalidations.push(input);
          return Promise.resolve();
        },
      },
    } as unknown as ScopeResolutionUseCases;

    initializeScopeResolutionEvents({
      eventBus,
      scopeResolutionUseCases,
      logger: { warn: () => undefined } as never,
    });

    await dispatch({
      type: "file_watcher_file_changed",
      projectRoot: "/repo",
      path: "apps/desktop/src/routes/home.tsx",
      eventKind: "changed",
      occurredAt: "2026-06-20T00:00:00.000Z",
      sessions: [{ userId: "user-1", chatId: "chat-1" }],
    });

    expect(invalidations).toEqual([
      {
        projectRoot: "/repo",
        path: "apps/desktop/src/routes/home.tsx",
      },
    ]);
  });
});
