import { describe, expect, test } from "bun:test";
import type { SessionUseCases } from "@/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { initializeSubagentEvents } from "./subagent-events.init";

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

describe("initializeSubagentEvents", () => {
  test("routes subagent start and turn-complete lifecycle events", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const { dispatch, eventBus } = createEventBusStub();
    const sessionUseCases = {
      subagents: {
        startInvocation(input: unknown) {
          calls.push({ name: "start", input });
          return Promise.resolve();
        },
        completeInvocationsForTurn(input: unknown) {
          calls.push({ name: "complete", input });
          return Promise.resolve();
        },
      },
    } as unknown as SessionUseCases;

    initializeSubagentEvents({
      eventBus,
      sessionUseCases,
      logger: { warn: () => undefined } as never,
    });
    await dispatch({
      type: "subagent_invocation_requested",
      userId: "user-1",
      chatId: "chat-1",
      projectRoot: "/repo",
      agentSessionId: "agent-session-1",
      turnId: "turn-1",
      subagent: {
        name: "reviewer",
        description: "Review code",
        sourcePath: ".agents/reviewer.md",
      },
    });
    await dispatch({
      type: "prompt_turn_completed",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
      source: "client",
    });
    await dispatch({
      type: "prompt_message_sent",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      source: "client",
    });

    expect(calls).toEqual([
      {
        name: "start",
        input: {
          userId: "user-1",
          chatId: "chat-1",
          agentSessionId: "agent-session-1",
          turnId: "turn-1",
          subagent: {
            name: "reviewer",
            description: "Review code",
            sourcePath: ".agents/reviewer.md",
          },
        },
      },
      {
        name: "complete",
        input: {
          userId: "user-1",
          chatId: "chat-1",
          turnId: "turn-1",
          stopReason: "end_turn",
        },
      },
    ]);
  });
});
