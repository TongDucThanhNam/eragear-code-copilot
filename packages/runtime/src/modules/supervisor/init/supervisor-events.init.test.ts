import { describe, expect, test } from "bun:test";
import type { SupervisorUseCases } from "#runtime/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeSupervisorEvents } from "./supervisor-events.init";

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

describe("initializeSupervisorEvents", () => {
  test("schedules reviews for non-automation completed turns", async () => {
    const calls: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const supervisorUseCases = {
      loop: {
        scheduleReview(input: unknown) {
          calls.push(input);
        },
      },
    } as unknown as SupervisorUseCases;

    initializeSupervisorEvents({
      eventBus,
      supervisorUseCases,
      logger: { warn: () => undefined } as never,
    });

    await dispatch({
      type: "prompt_turn_completed",
      source: "client",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
    });
    await dispatch({
      type: "prompt_turn_completed",
      source: "automation",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-2",
      turnId: "turn-2",
      stopReason: "end_turn",
    });
    await dispatch({
      type: "prompt_message_sent",
      source: "client",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-3",
      turnId: "turn-3",
    });
    await dispatch({
      type: "prompt_turn_completed",
      source: "orchestrator",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "worker-chat",
      turnId: "turn-4",
      stopReason: "end_turn",
    });

    expect(calls).toEqual([
      {
        chatId: "chat-1",
        userId: "user-1",
        turnId: "turn-1",
        stopReason: "end_turn",
        source: "client",
      },
    ]);
  });
});
