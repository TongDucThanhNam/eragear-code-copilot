import { describe, expect, test } from "bun:test";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import type { WorkerSessionManagerPort } from "../application/ports/worker-session-manager.port";
import { initializeSupervisorOrchestrationEvents } from "./supervisor-orchestration-events.init";

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

describe("initializeSupervisorOrchestrationEvents", () => {
  test("routes a bound orchestrator turn exactly once and excludes unrelated sources", async () => {
    const reviews: unknown[] = [];
    const claims = new Set<string>();
    const workerSessions = {
      claimCompletedTurn(input: { chatId: string; turnId: string }) {
        const key = `${input.chatId}:${input.turnId}`;
        if (input.chatId !== "worker-chat" || claims.has(key)) {
          return Promise.resolve(null);
        }
        claims.add(key);
        return Promise.resolve({
          runId: "run-1",
          taskId: "task-1",
          attemptId: "attempt-1",
          userId: "user-1",
          chatId: input.chatId,
          turnId: input.turnId,
        });
      },
      claimTerminalDecision() {
        return Promise.resolve(null);
      },
    } as unknown as WorkerSessionManagerPort;
    const { dispatch, eventBus } = createEventBusStub();
    initializeSupervisorOrchestrationEvents({
      eventBus,
      workerSessions,
      supervisorLoop: {
        scheduleReview(input: unknown) {
          reviews.push(input);
        },
      },
      orchestrator: {
        recordWorkerTerminal() {
          throw new Error("not expected");
        },
      },
      logger: { warn: () => undefined } as never,
    });

    const workerEvent: DomainEvent = {
      type: "prompt_turn_completed",
      source: "orchestrator",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "worker-chat",
      turnId: "turn-1",
      stopReason: "end_turn",
    };
    await dispatch(workerEvent);
    await dispatch(workerEvent);
    await dispatch({
      ...workerEvent,
      chatId: "unbound-chat",
      turnId: "turn-2",
    });
    await dispatch({ ...workerEvent, source: "automation", turnId: "turn-3" });
    await dispatch({ ...workerEvent, source: "client", turnId: "turn-4" });

    expect(reviews).toEqual([
      {
        chatId: "worker-chat",
        userId: "user-1",
        turnId: "turn-1",
        stopReason: "end_turn",
        source: "orchestrator",
      },
    ]);
  });

  test("claims a terminal decision and records its structured result once", async () => {
    const recorded: unknown[] = [];
    let claimed = false;
    const { dispatch, eventBus } = createEventBusStub();
    initializeSupervisorOrchestrationEvents({
      eventBus,
      workerSessions: {
        claimTerminalDecision() {
          if (claimed) {
            return Promise.resolve(null);
          }
          claimed = true;
          return Promise.resolve({
            runId: "run-1",
            taskId: "task-1",
            attemptId: "attempt-1",
            userId: "user-1",
            chatId: "worker-chat",
          });
        },
      } as unknown as WorkerSessionManagerPort,
      supervisorLoop: { scheduleReview: () => undefined },
      orchestrator: {
        recordWorkerTerminal(input) {
          recorded.push(input);
          return Promise.resolve({} as never);
        },
      },
      logger: { warn: () => undefined } as never,
    });
    const event: DomainEvent = {
      type: "supervisor_turn_terminal",
      userId: "user-1",
      chatId: "worker-chat",
      turnId: "turn-2",
      source: "orchestrator",
      action: "done",
      reason: "verified",
      resultText: '{"semanticStatus":"succeeded"}',
    };

    await dispatch(event);
    await dispatch(event);

    expect(recorded).toEqual([
      {
        runId: "run-1",
        userId: "user-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        action: "done",
        reason: "verified",
        resultText: '{"semanticStatus":"succeeded"}',
      },
    ]);
  });
});
