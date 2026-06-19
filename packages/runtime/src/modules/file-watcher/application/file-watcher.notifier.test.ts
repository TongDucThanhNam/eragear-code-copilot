import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { createEventBusFileWatcherNotifier } from "./file-watcher.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("FileWatcherNotifier", () => {
  test("publishes file watcher changed events", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusFileWatcherNotifier(
      createEventBusStub(events),
      {
        now: () => new Date("2026-06-12T12:00:00.000Z"),
      }
    );

    await notifier.fileChanged({
      projectRoot: "/repo",
      path: "src/app.ts",
      eventKind: "changed",
      sessions: [
        {
          userId: "user-1",
          chatId: "chat-1",
          projectId: "project-1",
        },
      ],
    });

    expect(events).toEqual([
      {
        type: "file_watcher_file_changed",
        projectRoot: "/repo",
        path: "src/app.ts",
        eventKind: "changed",
        occurredAt: "2026-06-12T12:00:00.000Z",
        sessions: [
          {
            userId: "user-1",
            chatId: "chat-1",
            projectId: "project-1",
          },
        ],
      },
    ]);
  });
});
