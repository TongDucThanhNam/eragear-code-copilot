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
    modes?: {
      currentModeId: string;
      availableModes: Array<{
        id: string;
        name: string;
        description?: string | null;
      }>;
    };
    configOptions?: Array<{
      id: string;
      category?: string;
      currentValue?: string;
      options?: Array<{ value: string }>;
    }>;
    preferredEffort?: string;
  } = {}
) {
  const runs = new MemoryRunRepository(options.run ?? createWorkerRun());
  const created: Array<{
    chatId?: string;
    agentId?: string;
    trustedProjectRoot?: string;
    envMode?: "local" | "worktree";
    worktreePath?: string;
  }> = [];
  const sent: Array<{ chatId: string; text: string; source: string }> = [];
  const stopped: string[] = [];
  const selectedModels: string[] = [];
  const selectedModes: string[] = [];
  const selectedEfforts: string[] = [];
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
          ...(options.modes ? { modes: options.modes } : {}),
          ...(options.configOptions
            ? { configOptions: options.configOptions }
            : {}),
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
        return Promise.resolve({
          ok: true,
          configOptions: options.configOptions,
        });
      },
    },
    setModel: {
      execute(_userId, _chatId, modelId) {
        selectedModels.push(modelId);
        return Promise.resolve();
      },
    },
    setMode: {
      execute(_userId, _chatId, modeId) {
        selectedModes.push(modeId);
        return Promise.resolve();
      },
    },
    setConfigOption: {
      execute(_userId, _chatId, configId, value) {
        selectedEfforts.push(`${configId}:${value}`);
        return Promise.resolve();
      },
    },
    preferredEffort: options.preferredEffort,
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
    selectedModes,
    selectedEfforts,
    service: new WorkerSessionManagerService(deps),
  };
}

describe("WorkerSessionManagerService", () => {
  test("keeps every ACP worker on the dedicated builder role", async () => {
    const run = createWorkerRun();
    run.tasks = run.tasks.map((task) => ({
      ...task,
      executionMode: task.taskId === "task-a" ? "read_only" : "write",
    }));
    const harness = createHarness({
      run,
      modes: {
        currentModeId: "manager",
        availableModes: [
          { id: "manager", name: "manager" },
          { id: "builder", name: "builder" },
        ],
      },
      configOptions: [
        {
          id: "effort",
          category: "thought_level",
          currentValue: "none",
          options: [{ value: "none" }, { value: "xhigh" }],
        },
      ],
      preferredEffort: "xhigh",
    });

    await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      idempotencyKey: "run-1:task-a:1",
    });
    await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-b",
      idempotencyKey: "run-1:task-b:1",
    });

    expect(harness.selectedModes).toEqual(["builder", "builder"]);
    expect(harness.selectedEfforts).toEqual(["effort:xhigh", "effort:xhigh"]);
    expect(harness.sent).toHaveLength(2);
  });

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
      workspace: {
        workspaceId: "workspace-task-b",
        kind: "direct_git",
        userProjectRoot: "C:/repo",
        projectRoot: "C:/repo",
        repositoryRoot: "C:/repo",
        baseHead: "abc123",
        targetFingerprints: {},
      },
    });
    expect(first.attempt.chatId).not.toBe(second.attempt.chatId);
    expect(first.attempt.agentSessionId).toBe("agent-session-1");
    expect(second.attempt.agentSessionId).toBe("agent-session-2");
    expect(harness.created).toHaveLength(2);
    expect(harness.created[1]?.trustedProjectRoot).toBe("C:/repo");
    expect(harness.created[1]?.envMode).toBeUndefined();
    expect(harness.created[1]?.worktreePath).toBeUndefined();
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

  test("releases a terminal worker process without mutating run state", async () => {
    const harness = createHarness();
    const dispatched = await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      idempotencyKey: "run-1:task-a:1",
    });
    const before = await harness.runs.get("run-1", "user-1");

    await harness.service.release({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      attemptId: dispatched.attempt.attemptId,
    });

    const after = await harness.runs.get("run-1", "user-1");
    expect(harness.stopped).toEqual([dispatched.attempt.chatId]);
    expect(after).toEqual(before);
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
        legacyAutomation: {
          scheduleId: "schedule-1",
          providerId: "zai-coding-plan",
          workerModelId: "glm-zai",
        },
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
        legacyAutomation: {
          scheduleId: "schedule-1",
          providerId: "zai-coding-plan",
          workerModelId: "claude",
        },
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

  test("selects and persists a Manager-assigned model for a normal Supervisor task", async () => {
    const run = createWorkerRun();
    const task = run.tasks[0];
    if (!task) {
      throw new Error("Expected worker fixture task");
    }
    task.preferredModelId = "minimax-coding-plan/MiniMax-M3";
    const harness = createHarness({
      run,
      models: {
        currentModelId: "zai-coding-plan/glm-5.3",
        availableModels: [
          {
            modelId: "zai-coding-plan/glm-5.3",
            provider: "zai-coding-plan",
          },
          {
            modelId: "minimax-coding-plan/MiniMax-M3",
            provider: "minimax-coding-plan",
          },
        ],
      },
    });

    const dispatched = await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: task.taskId,
      idempotencyKey: "run-1:task-a:1",
    });

    expect(harness.selectedModels).toEqual(["minimax-coding-plan/MiniMax-M3"]);
    expect(dispatched.attempt.modelId).toBe("minimax-coding-plan/MiniMax-M3");
  });

  test("submits the original task after capacity recovers before the first turn", async () => {
    const base = createWorkerRun();
    const task = base.tasks[0];
    if (!task) {
      throw new Error("Expected worker fixture task");
    }
    const harness = createHarness({
      run: {
        ...base,
        status: "running",
        tasks: [
          {
            ...task,
            status: "running",
            attempts: [
              {
                attemptId: "attempt-quota",
                chatId: "chat-quota",
                agentId: task.preferredAgentId ?? "agent-code",
                agentSessionId: "acp-session-quota",
                status: "running",
                idempotencyKey: "run-1:task-a:1",
                startedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });

    await harness.service.resumePendingCapacity({
      runId: "run-1",
      userId: "user-1",
      taskId: task.taskId,
      attemptId: "attempt-quota",
    });

    expect(harness.created).toHaveLength(0);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.chatId).toBe("chat-quota");
    expect(harness.sent[0]?.text).toContain(`# Task: ${task.title}`);
    expect(harness.sent[0]?.text).not.toContain("Continue the current task");
    const run = await harness.runs.get("run-1", "user-1");
    expect(run?.tasks[0]?.attempts[0]?.turnId).toBe("turn-1");
  });

  test("continues the existing task after capacity interrupts an active turn", async () => {
    const base = createWorkerRun();
    const task = base.tasks[0];
    if (!task) {
      throw new Error("Expected worker fixture task");
    }
    const harness = createHarness({
      run: {
        ...base,
        status: "running",
        tasks: [
          {
            ...task,
            status: "running",
            attempts: [
              {
                attemptId: "attempt-quota",
                chatId: "chat-quota",
                agentId: task.preferredAgentId ?? "agent-code",
                agentSessionId: "acp-session-quota",
                status: "running",
                turnId: "turn-before-quota",
                idempotencyKey: "run-1:task-a:1",
                startedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });

    await harness.service.resumePendingCapacity({
      runId: "run-1",
      userId: "user-1",
      taskId: task.taskId,
      attemptId: "attempt-quota",
    });

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.text).toContain("Continue the current task");
    expect(harness.sent[0]?.text).not.toContain(task.goal);
    const run = await harness.runs.get("run-1", "user-1");
    expect(run?.tasks[0]?.attempts[0]?.turnId).toBe("turn-1");
  });

  test("continues the same attempt after an exact recovery resume", async () => {
    const base = createWorkerRun();
    const task = base.tasks[0];
    if (!task) {
      throw new Error("Expected worker fixture task");
    }
    const harness = createHarness({
      run: {
        ...base,
        status: "running",
        tasks: [
          {
            ...task,
            status: "running",
            attempts: [
              {
                attemptId: "attempt-recovery",
                chatId: "chat-recovery",
                agentId: task.preferredAgentId ?? "agent-code",
                agentSessionId: "acp-session-recovery",
                status: "running",
                turnId: "turn-before-restart",
                idempotencyKey: "run-1:task-a:1",
                startedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });

    await harness.service.resume({
      runId: "run-1",
      userId: "user-1",
      taskId: task.taskId,
      attemptId: "attempt-recovery",
    });

    expect(harness.created).toHaveLength(0);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.chatId).toBe("chat-recovery");
    expect(harness.sent[0]?.source).toBe("orchestrator");
    expect(harness.sent[0]?.text).toContain("Continue the current task");
    expect(harness.sent[0]?.text).not.toContain("compact JSON object");
    const run = await harness.runs.get("run-1", "user-1");
    expect(run?.tasks[0]?.attempts[0]?.turnId).toBe("turn-1");
  });
});
