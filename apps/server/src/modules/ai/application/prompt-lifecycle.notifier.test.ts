import { describe, expect, test } from "bun:test";
import type {
  EventBusListener,
  EventBusPort,
} from "@/shared/ports/event-bus.port";
import type { DomainEvent } from "@/shared/types/domain-events.types";
import { createEventBusPromptLifecycleNotifier } from "./prompt-lifecycle.notifier";

function createEventBusStub(events: DomainEvent[]): EventBusPort {
  return {
    subscribe(_listener: EventBusListener) {
      return () => undefined;
    },
    publish(event: DomainEvent) {
      events.push(event);
      return Promise.resolve();
    },
  };
}

describe("PromptLifecycleNotifier", () => {
  test("translates prompt lifecycle facts into domain events", async () => {
    const events: DomainEvent[] = [];
    const promptLifecycle = createEventBusPromptLifecycleNotifier({
      eventBus: createEventBusStub(events),
      logger: { warn: () => undefined } as never,
    });

    await promptLifecycle.afterMessageSend({
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
      turnId: "turn-1",
      source: "client",
    });
    await promptLifecycle.requestSubagentInvocation({
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
      turnId: "turn-1",
      subagent: {
        name: "reviewer",
        description: "Review code",
        sourcePath: ".agents/reviewer.md",
      },
    });
    await promptLifecycle.afterTurnComplete({
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-1",
      turnId: "turn-1",
      stopReason: "end_turn",
      source: "supervisor",
    });

    expect(events).toEqual([
      {
        type: "prompt_message_sent",
        userId: "user-1",
        projectRoot: "/repo",
        projectId: "project-1",
        chatId: "chat-1",
        agentSessionId: "agent-session-1",
        turnId: "turn-1",
        source: "client",
      },
      {
        type: "subagent_invocation_requested",
        userId: "user-1",
        projectRoot: "/repo",
        chatId: "chat-1",
        agentSessionId: "agent-session-1",
        turnId: "turn-1",
        subagent: {
          name: "reviewer",
          description: "Review code",
          sourcePath: ".agents/reviewer.md",
        },
      },
      {
        type: "prompt_turn_completed",
        userId: "user-1",
        projectRoot: "/repo",
        chatId: "chat-1",
        turnId: "turn-1",
        stopReason: "end_turn",
        source: "supervisor",
      },
    ]);
  });
});
