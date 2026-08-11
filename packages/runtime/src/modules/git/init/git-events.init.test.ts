import { describe, expect, test } from "bun:test";
import type { GitUseCases } from "#runtime/modules/use-cases";
import type {
  EventBusListener,
  EventBusPort,
} from "#runtime/shared/ports/event-bus.port";
import type { DomainEvent } from "#runtime/shared/types/domain-events.types";
import { initializeGitEvents } from "./git-events.init";

function createEventBusStub() {
  const listeners = new Set<EventBusListener>();
  const eventBus: EventBusPort = {
    subscribe(nextListener) {
      listeners.add(nextListener);
      return () => {
        listeners.delete(nextListener);
      };
    },
    publish() {
      return Promise.resolve();
    },
  };
  return {
    eventBus,
    async dispatch(event: DomainEvent) {
      for (const listener of listeners) {
        await listener(event, { signal: new AbortController().signal });
      }
    },
  };
}

describe("initializeGitEvents", () => {
  test("captures a turn-zero baseline before the agent turn starts", async () => {
    const calls: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const gitUseCases = {
      checkpoints: {
        captureTurnBaseline(input: unknown) {
          calls.push(input);
          return Promise.resolve({
            ref: "refs/eragear/session-chat-1-turn-0",
          });
        },
      },
    } as unknown as GitUseCases;

    initializeGitEvents({
      eventBus,
      gitUseCases,
      sessionRuntime: { broadcast: async () => undefined } as never,
      logger: { warn: () => undefined } as never,
    });
    await dispatch({
      type: "prompt_turn_started",
      userId: "user-1",
      projectRoot: "/repo",
      projectId: "project-1",
      chatId: "chat-1",
      agentSessionId: "agent-session-1",
      turnId: "turn-1",
      source: "client",
    });

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

  test("captures and broadcasts a ref-based diff after turn completion", async () => {
    const calls: unknown[] = [];
    const broadcasts: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    const gitUseCases = {
      checkpoints: {
        captureCompletedTurn(input: unknown) {
          calls.push({ kind: "turn", input });
          return Promise.resolve({
            from: { turnCount: 0 },
            to: { turnCount: 1 },
            files: [
              {
                path: "src/main.ts",
                kind: "modified",
                additions: 2,
                deletions: 1,
              },
            ],
          });
        },
        createAutomaticCheckpoint(input: unknown) {
          calls.push({ kind: "legacy", input });
          return Promise.resolve();
        },
      },
    } as unknown as GitUseCases;

    initializeGitEvents({
      eventBus,
      gitUseCases,
      sessionRuntime: {
        broadcast: (_chatId: string, event: unknown) => {
          broadcasts.push(event);
          return Promise.resolve();
        },
      } as never,
      logger: { warn: () => undefined } as never,
    });
    await dispatch({
      type: "prompt_message_sent",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "chat-ignored",
      turnId: "turn-ignored",
      source: "client",
    });
    await dispatch({
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
    expect(calls).toEqual([
      {
        kind: "turn",
        input: {
          userId: "user-1",
          projectRoot: "/repo",
          projectId: "project-1",
          chatId: "chat-1",
          agentSessionId: "agent-session-1",
          turnId: "turn-1",
        },
      },
      {
        kind: "legacy",
        input: {
          userId: "user-1",
          projectRoot: "/repo",
          projectId: "project-1",
          chatId: "chat-1",
          agentSessionId: "agent-session-1",
          turnId: "turn-1",
        },
      },
    ]);
    expect(broadcasts).toEqual([
      {
        type: "prompt_turn_diff_ready",
        turnId: "turn-1",
        turnCount: 1,
        files: [
          {
            path: "src/main.ts",
            kind: "modified",
            additions: 2,
            deletions: 1,
          },
        ],
      },
    ]);
  });
});
