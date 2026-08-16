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
  test("resumes capacity waits only after the refreshed provider has quota", async () => {
    const resumeCalls: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    initializeSupervisorOrchestrationEvents({
      eventBus,
      capacity: {
        resumeDue(input) {
          resumeCalls.push(input);
          return Promise.resolve({ resumed: 1, failedClosed: 0 });
        },
      },
      workerSessions: {} as WorkerSessionManagerPort,
      workerResults: { latestAssistantText: () => Promise.resolve(null) },
      orchestrator: {
        recordWorkerTerminal: () => Promise.resolve({} as never),
      },
      logger: { warn: () => undefined } as never,
    });

    const quotaEvent: DomainEvent = {
      type: "provider_quota_refreshed",
      userId: "user-1",
      providerId: "zai",
      providerDisplayName: "Z.ai Coding Plan",
      status: "ready",
      fetchedAt: "2026-08-13T06:00:00.000Z",
      windows: [
        {
          id: "5h",
          label: "5h",
          percentRemaining: 0,
          resetAt: "2026-08-13T09:31:50.752Z",
        },
      ],
      minPercentRemaining: 0,
      nextResetAt: "2026-08-13T09:31:50.752Z",
      changed: true,
    };
    await dispatch(quotaEvent);
    await dispatch({
      ...quotaEvent,
      windows: [
        {
          id: "5h",
          label: "5h",
          percentRemaining: 100,
          resetAt: "2026-08-13T09:31:50.752Z",
        },
      ],
      minPercentRemaining: 100,
    });

    expect(resumeCalls).toEqual([
      {
        userId: "user-1",
        capacityGroup: "zai",
        forceDue: true,
      },
    ]);
  });

  test("routes an unexpected ACP stop to the bound manager before workers", async () => {
    const managerStops: unknown[] = [];
    const workerStops: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    initializeSupervisorOrchestrationEvents({
      eventBus,
      manager: {
        claimStoppedTurn(input: {
          userId: string;
          chatId: string;
          reason?: string;
        }) {
          managerStops.push(input);
          return Promise.resolve({
            runId: "run-1",
            userId: "user-1",
            turnId: "turn-1",
          });
        },
      } as never,
      workerSessions: {
        claimStoppedSession(input: unknown) {
          workerStops.push(input);
          return Promise.resolve(null);
        },
      } as unknown as WorkerSessionManagerPort,
      workerResults: { latestAssistantText: () => Promise.resolve(null) },
      orchestrator: {
        recordWorkerTerminal: () => Promise.resolve({} as never),
      },
      logger: { warn: () => undefined } as never,
    });

    await dispatch({
      type: "agent_session_stopped",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "manager-chat-1",
      agentSessionId: "acp-1",
      stopReason: "Agent process exited with code 1",
    });

    expect(managerStops).toEqual([
      {
        userId: "user-1",
        chatId: "manager-chat-1",
        reason: "Agent process exited with code 1",
      },
    ]);
    expect(workerStops).toEqual([]);
  });

  test("records an unexpectedly stopped ACP worker as needing user input", async () => {
    const recorded: unknown[] = [];
    const { dispatch, eventBus } = createEventBusStub();
    initializeSupervisorOrchestrationEvents({
      eventBus,
      workerSessions: {
        claimStoppedSession() {
          return Promise.resolve({
            runId: "run-1",
            taskId: "task-1",
            attemptId: "attempt-1",
            userId: "user-1",
            chatId: "worker-chat",
          });
        },
      } as unknown as WorkerSessionManagerPort,
      workerResults: { latestAssistantText: () => Promise.resolve(null) },
      orchestrator: {
        recordWorkerTerminal(input) {
          recorded.push(input);
          return Promise.resolve({} as never);
        },
      },
      logger: { warn: () => undefined } as never,
    });

    await dispatch({
      type: "agent_session_stopped",
      userId: "user-1",
      projectRoot: "/repo",
      chatId: "worker-chat",
      agentSessionId: "worker-acp-1",
      stopReason: "Agent process exited with code 1",
    });

    expect(recorded).toEqual([
      {
        runId: "run-1",
        userId: "user-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        action: "needs_user",
        reason: "Agent process exited with code 1",
        resultText: "",
      },
    ]);
  });

  test("records a bound ACP worker result exactly once and excludes unrelated sources", async () => {
    const recorded: unknown[] = [];
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
      workerResults: {
        latestAssistantText() {
          return Promise.resolve('{"semanticStatus":"succeeded"}');
        },
      },
      orchestrator: {
        recordWorkerTerminal(input) {
          recorded.push(input);
          return Promise.resolve({} as never);
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

    expect(recorded).toEqual([
      {
        runId: "run-1",
        userId: "user-1",
        taskId: "task-1",
        attemptId: "attempt-1",
        action: "done",
        reason: "ACP worker completed with a persisted assistant handoff",
        resultText: '{"semanticStatus":"succeeded"}',
      },
    ]);
  });

  test("claims a terminal decision and records its handoff once", async () => {
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
      workerResults: { latestAssistantText: () => Promise.resolve(null) },
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
