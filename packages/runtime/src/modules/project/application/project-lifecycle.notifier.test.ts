import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { createEventBusProjectLifecycleNotifier } from "./project-lifecycle.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe: () => () => undefined,
    publish(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("ProjectLifecycleNotifier", () => {
  test("publishes dashboard refresh events for project mutations", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusProjectLifecycleNotifier(
      createEventBusStub(events)
    );

    await notifier.projectCreated({
      userId: "user-1",
      projectId: "project-1",
    });
    await notifier.projectUpdated({
      userId: "user-1",
      projectId: "project-1",
    });
    await notifier.projectSetActive({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(events).toEqual([
      {
        type: "dashboard_refresh",
        reason: "project_created",
        userId: "user-1",
        projectId: "project-1",
      },
      {
        type: "dashboard_refresh",
        reason: "project_updated",
        userId: "user-1",
        projectId: "project-1",
      },
      {
        type: "dashboard_refresh",
        reason: "project_set_active",
        userId: "user-1",
        projectId: "project-1",
      },
    ]);
  });

  test("publishes project deletion events in cleanup-safe order", async () => {
    const events: DomainEvent[] = [];
    const notifier = createEventBusProjectLifecycleNotifier(
      createEventBusStub(events)
    );
    const input = {
      userId: "user-1",
      projectId: "project-1",
      projectPath: "C:/repo",
    };

    await notifier.beforeProjectDelete(input);
    await notifier.afterProjectDeleted(input);

    expect(events).toEqual([
      {
        type: "project_deleting",
        userId: "user-1",
        projectId: "project-1",
        projectPath: "C:/repo",
      },
      {
        type: "project_deleted",
        userId: "user-1",
        projectId: "project-1",
        projectPath: "C:/repo",
      },
      {
        type: "dashboard_refresh",
        reason: "project_deleted",
        userId: "user-1",
        projectId: "project-1",
      },
    ]);
  });
});
