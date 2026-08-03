import { describe, expect, test } from "bun:test";
import type { SupervisorRunState as RunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  type WorkerSessionManagerDeps,
  WorkerSessionManagerService,
} from "./worker-session-manager.service";

class MemoryRunRepository implements SupervisorRunRepositoryPort {
  private run: RunState;

  constructor(run: RunState) {
    this.run = structuredClone(run);
  }

  create(run: RunState): Promise<RunState> {
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }

  get(runId: string, userId: string): Promise<RunState | null> {
    return Promise.resolve(
      this.run.runId === runId && this.run.userId === userId
        ? structuredClone(this.run)
        : null
    );
  }

  list(): Promise<RunState[]> {
    return Promise.resolve([structuredClone(this.run)]);
  }

  listNonTerminal(): Promise<RunState[]> {
    return Promise.resolve([structuredClone(this.run)]);
  }

  save(run: RunState, expectedRevision: number): Promise<RunState> {
    if (this.run.revision !== expectedRevision) {
      return Promise.reject(
        new SupervisorRunRevisionConflictError(
          run.runId,
          expectedRevision,
          this.run.revision
        )
      );
    }
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }
}

function createWorkerRun(overrides: Partial<RunState> = {}): RunState {
  const run = createSupervisorRunFixture();
  return {
    ...run,
    status: "queued",
    tasks: run.tasks.map((task) => ({
      ...task,
      dependencies: [],
      status: "queued" as const,
      preferredAgentId: task.preferredAgentId ?? "agent-code",
    })),
    ...overrides,
  };
}

function createHarness(
  options: {
    createFails?: boolean;
    run?: RunState;
    models?: {
      currentModelId: string;
      availableModels: Array<{
        modelId: string;
        provider?: string;
        providers?: string[];
      }>;
    };
  } = {}
) {
  const runs = new MemoryRunRepository(options.run ?? createWorkerRun());
  const created: Array<{
    chatId?: string;
    agentId?: string;
    projectRoot?: string;
  }> = [];
  const sent: Array<{ chatId: string; text: string; source: string }> = [];
  const stopped: string[] = [];
  const selectedModels: string[] = [];
  let id = 0;
  const deps: WorkerSessionManagerDeps = {
    runs,
    createSession: {
      execute(input) {
        created.push(input);
        if (options.createFails) {
          return Promise.reject(new Error("create failed"));
        }
        return Promise.resolve({
          id: input.chatId ?? "missing-chat",
          sessionId: `agent-session-${created.length}`,
          ...(options.models ? { models: options.models } : {}),
        });
      },
    },
    sendMessage: {
      execute(input) {
        sent.push(input);
        return Promise.resolve({ turnId: `turn-${sent.length}` });
      },
    },
    stopSession: {
      execute(_userId, chatId) {
        stopped.push(chatId);
        return Promise.resolve({ ok: true });
      },
    },
    resumeSession: {
      execute() {
        return Promise.resolve({ ok: true });
      },
    },
    setModel: {
      execute(_userId, _chatId, modelId) {
        selectedModels.push(modelId);
        return Promise.resolve();
      },
    },
    now: () => "2026-07-11T00:00:00.000Z",
    createId(prefix) {
      id += 1;
      return `${prefix}-${id}`;
    },
  };
  return {
    runs,
    created,
    sent,
    stopped,
    selectedModels,
    service: new WorkerSessionManagerService(deps),
  };
}

describe("WorkerSessionManagerService", () => {
  test("provisions distinct sessions through existing service facades and binds turns", async () => {
    const harness = createHarness();
    const first = await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      idempotencyKey: "run-1:task-a:1",
    });
    const second = await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-b",
      idempotencyKey: "run-1:task-b:1",
      isolatedProjectRoot: "C:/isolated/task-b",
    });
    expect(first.attempt.chatId).not.toBe(second.attempt.chatId);
    expect(first.attempt.agentSessionId).toBe("agent-session-1");
    expect(second.attempt.agentSessionId).toBe("agent-session-2");
    expect(harness.created).toHaveLength(2);
    expect(harness.created[1]?.projectRoot).toBe("C:/isolated/task-b");
    expect(harness.sent.map((item) => item.source)).toEqual([
      "orchestrator",
      "orchestrator",
    ]);
    const binding = await harness.service.findBinding({
      userId: "user-1",
      chatId: first.attempt.chatId,
      turnId: first.attempt.turnId,
    });
    expect(binding).toMatchObject({
      runId: "run-1",
      taskId: "task-a",
      attemptId: first.attempt.attemptId,
    });
  });

  test("deduplicates repeated dispatch by persisted idempotency key", async () => {
    const harness = createHarness();
    const input = {
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      idempotencyKey: "run-1:task-a:1",
    };
    const first = await harness.service.dispatch(input);
    const duplicate = await harness.service.dispatch(input);
    expect(duplicate.alreadyDispatched).toBeTrue();
    expect(duplicate.attempt.attemptId).toBe(first.attempt.attemptId);
    expect(harness.created).toHaveLength(1);
    expect(harness.sent).toHaveLength(1);
  });

  test("marks a reserved attempt interrupted and fails the task when creation fails", async () => {
    const harness = createHarness({ createFails: true });
    await expect(
      harness.service.dispatch({
        runId: "run-1",
        userId: "user-1",
        taskId: "task-a",
        idempotencyKey: "run-1:task-a:1",
      })
    ).rejects.toThrow("create failed");
    const run = await harness.runs.get("run-1", "user-1");
    expect(run?.tasks[0]?.status).toBe("failed");
    expect(run?.tasks[0]?.attempts[0]?.status).toBe("interrupted");
    expect(run?.tasks[0]?.attempts[0]?.finishedAt).toBeDefined();
  });

  test("rejects cross-user binding discovery", async () => {
    const harness = createHarness();
    const result = await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      idempotencyKey: "run-1:task-a:1",
    });
    expect(
      await harness.service.findBinding({
        userId: "user-2",
        chatId: result.attempt.chatId,
      })
    ).toBeNull();
  });

  test("selects only the scheduled provider model and fails closed on mismatch", async () => {
    const compatible = createHarness({
      run: createWorkerRun({
        scheduleId: "schedule-1",
        providerId: "zai-coding-plan",
        workerModelId: "glm-zai",
      }),
      models: {
        currentModelId: "glm-default",
        availableModels: [
          { modelId: "glm-default", provider: "zai-coding-plan" },
          { modelId: "glm-zai", provider: "zai-coding-plan" },
        ],
      },
    });

    await compatible.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      idempotencyKey: "run-1:task-a:1",
    });
    expect(compatible.selectedModels).toEqual(["glm-zai"]);

    const mismatch = createHarness({
      run: createWorkerRun({
        scheduleId: "schedule-1",
        providerId: "zai-coding-plan",
        workerModelId: "claude",
      }),
      models: {
        currentModelId: "claude",
        availableModels: [{ modelId: "claude", provider: "anthropic" }],
      },
    });
    await expect(
      mismatch.service.dispatch({
        runId: "run-1",
        userId: "user-1",
        taskId: "task-a",
        idempotencyKey: "run-1:task-a:1",
      })
    ).rejects.toThrow(
      "Scheduled worker model claude is incompatible with provider zai-coding-plan"
    );
    expect(mismatch.sent).toEqual([]);
    expect(mismatch.stopped).toHaveLength(1);
  });
});
