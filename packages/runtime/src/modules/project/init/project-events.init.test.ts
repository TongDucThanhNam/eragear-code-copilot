import { describe, expect, test } from "bun:test";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeProjectEvents } from "./project-events.init";

class FakeEventBus implements EventBusPort {
  private listener: EventBusListener | null = null;

  subscribe(listener: EventBusListener): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.listener?.(event, { signal: new AbortController().signal });
  }
}

describe("initializeProjectEvents", () => {
  test("cleans up sessions before project deletion", async () => {
    const eventBus = new FakeEventBus();
    const cleanupInputs: unknown[] = [];
    initializeProjectEvents({
      eventBus,
      sessionUseCases: {
        cleanupProjectSessions: {
          execute(input) {
            cleanupInputs.push(input);
            return Promise.resolve({
              deletedSessionIds: [],
              terminatedRuntimeCount: 0,
            });
          },
        },
      },
    });

    await eventBus.publish({
      type: "project_deleting",
      userId: "user-1",
      projectId: "project-1",
      projectPath: "C:/repo",
    });

    expect(cleanupInputs).toEqual([
      {
        userId: "user-1",
        projectId: "project-1",
        projectPath: "C:/repo",
      },
    ]);
  });

  test("ignores unrelated events", async () => {
    const eventBus = new FakeEventBus();
    const cleanupInputs: unknown[] = [];
    initializeProjectEvents({
      eventBus,
      sessionUseCases: {
        cleanupProjectSessions: {
          execute(input) {
            cleanupInputs.push(input);
            return Promise.resolve({
              deletedSessionIds: [],
              terminatedRuntimeCount: 0,
            });
          },
        },
      },
    });

    await eventBus.publish({
      type: "dashboard_refresh",
      reason: "project_updated",
      userId: "user-1",
      projectId: "project-1",
    });

    expect(cleanupInputs).toEqual([]);
  });
});
