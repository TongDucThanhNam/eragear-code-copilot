import { describe, expect, test } from "bun:test";
import type { SessionRuntimePort } from "#runtime/modules/session";
import type { FileWatcherUseCases } from "#runtime/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeFileWatcherEvents } from "./file-watcher-events.init";

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

describe("initializeFileWatcherEvents", () => {
  test("routes lifecycle events to watch/unwatch and broadcasts file changes", async () => {
    const calls: unknown[] = [];
    const broadcasts: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const fileWatcherUseCases = {
      fileWatcher: {
        watchSession(input: unknown) {
          calls.push(["watch", input]);
          return Promise.resolve();
        },
        unwatchSession(input: unknown) {
          calls.push(["unwatch", input]);
          return Promise.resolve();
        },
      },
    } as unknown as FileWatcherUseCases;
    const sessionRuntime = {
      broadcast(chatId: string, event: unknown) {
        broadcasts.push([chatId, event]);
        return Promise.resolve();
      },
    } as unknown as SessionRuntimePort;

    initializeFileWatcherEvents({
      eventBus,
      fileWatcherUseCases,
      sessionRuntime,
      logger: { warn: () => undefined } as never,
    });
    await dispatch({
      type: "prompt_message_sent",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      turnId: "turn-1",
      source: "client",
    });
    await dispatch({
      type: "agent_session_stopped",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
    });
    await dispatch({
      type: "file_watcher_file_changed",
      projectRoot: "/repo",
      path: "src/app.ts",
      eventKind: "changed",
      occurredAt: "2026-06-12T12:00:00.000Z",
      sessions: [{ userId: "user-1", chatId: "chat-1" }],
    });

    expect(calls).toEqual([
      [
        "watch",
        {
          userId: "user-1",
          chatId: "chat-1",
          projectRoot: "/repo",
          projectId: "project-1",
        },
      ],
      ["unwatch", { chatId: "chat-1" }],
    ]);
    expect(broadcasts).toEqual([
      ["chat-1", { type: "file_modified", path: "src/app.ts" }],
    ]);
  });
});
