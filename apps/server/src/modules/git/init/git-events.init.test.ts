import { describe, expect, test } from "bun:test";
import type { GitUseCases } from "@/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { initializeGitEvents } from "./git-events.init";

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

describe("initializeGitEvents", () => {
  test("creates automatic checkpoints after agent turn completion", async () => {
    const calls: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const gitUseCases = {
      checkpoints: {
        createAutomaticCheckpoint(input: unknown) {
          calls.push(input);
          return Promise.resolve();
        },
      },
    } as unknown as GitUseCases;

    initializeGitEvents({
      eventBus,
      gitUseCases,
      logger: { warn: () => undefined } as never,
    });
    dispatch({
      type: "prompt_message_sent",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-ignored",
      turnId: "turn-ignored",
      source: "client",
    });
    dispatch({
      type: "prompt_turn_completed",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
      turnId: "turn-1",
      stopReason: "end_turn",
      source: "client",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([
      {
        userId: "user-1",
        projectRoot: "/repo",
        projectId: "project-1",
        chatId: "chat-1",
        agentSessionId: "agent-session-1",
        turnId: "turn-1",
      },
    ]);
  });
});
