import { describe, expect, test } from "bun:test";
import { WorkflowEffectUncertainError } from "#runtime/modules/workflow";
import { NotFoundError } from "#runtime/shared/errors";
import {
  type SupervisorRunState as RunState,
  SupervisorRunStateSchema,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";
import {
  prepareSupervisorPrompt,
  type SupervisorEffectPromptDispatchPort,
} from "./ports/supervisor-effect-prompt-dispatch.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import {
  buildWorkerPrompt,
  buildWorkerResumePrompt,
} from "./worker-prompt.builder";
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
      activity: "dispatching" as const,
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
    dispatchError?: unknown;
    stopError?: unknown;
    capacity?: WorkerSessionManagerDeps["capacity"];
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
  const sent: Parameters<SupervisorEffectPromptDispatchPort["execute"]>[0][] =
    [];
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
    effectPromptDispatch: {
      execute(input) {
        sent.push(input);
        if (options.dispatchError !== undefined) {
          return Promise.reject(options.dispatchError);
        }
        return Promise.resolve({ turnId: `turn-${sent.length}` });
      },
    },
    stopSession: {
      execute(_userId, chatId) {
        stopped.push(chatId);
        if (options.stopError !== undefined) {
          return Promise.reject(options.stopError);
        }
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
    capacity: options.capacity,
    now: () => "2026-07-11T00:00:00.000Z",
    createId(prefix) {
      id += 1;
      return `${prefix}-${id}`;
    },
  };
  const preparePrompt = async (
    taskId: string,
    effectId: string,
    kind: "dispatch" | "resume" | "pending_capacity"
  ) => {
    const run = await runs.get("run-1", "user-1");
    if (!run) {
      throw new Error("Expected worker run");
    }
    const task = run.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) {
      throw new Error(`Expected worker task ${taskId}`);
    }
    const attempt = task.attempts.at(-1);
    const shouldResume =
      kind === "resume" || (kind === "pending_capacity" && attempt?.turnId);
    const text = shouldResume
      ? buildWorkerResumePrompt(task)
      : buildWorkerPrompt({
          run,
          task,
          dependencySummaries: task.dependencies.map((dependencyId) => {
            const dependency = run.tasks.find(
              (candidate) => candidate.taskId === dependencyId
            );
            const summary = [...(dependency?.attempts ?? [])]
              .reverse()
              .find((candidate) => candidate.result)?.result?.outcomeSummary;
            if (!summary) {
              throw new Error(`Expected result for dependency ${dependencyId}`);
            }
            return { taskId: dependencyId, summary };
          }),
        });
    return prepareSupervisorPrompt({
      effectId,
      authorityId: "authority-worker-test",
      text,
    });
  };
  return {
    runs,
    created,
    sent,
    stopped,
    selectedModels,
    selectedModes,
    selectedEfforts,
    prepareDispatchPrompt: (taskId: string, effectId: string) =>
      preparePrompt(taskId, effectId, "dispatch"),
    prepareResumePrompt: (taskId: string, effectId: string) =>
      preparePrompt(taskId, effectId, "resume"),
    preparePendingCapacityPrompt: (taskId: string, effectId: string) =>
      preparePrompt(taskId, effectId, "pending_capacity"),
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
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-a",
        "effect-builder-a"
      ),
    });
    await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-b",
      idempotencyKey: "run-1:task-b:1",
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-b",
        "effect-builder-b"
      ),
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
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-a",
        "effect-session-a"
      ),
    });
    const second = await harness.service.dispatch({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-b",
      idempotencyKey: "run-1:task-b:1",
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-b",
        "effect-session-b"
      ),
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
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-a",
        "effect-deduplicate"
      ),
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
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-a",
        "effect-release"
      ),
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

  test("treats a missing persisted chat as stopped without discarding terminal result evidence", async () => {
    const run = createWorkerRun();
    const task = run.tasks[0];
    if (!task) {
      throw new Error("Expected worker task");
    }
    task.status = "completed";
    task.outcome = "succeeded";
    task.attempts = [
      {
        attemptId: "attempt-terminal",
        chatId: "chat-terminal",
        agentId: "agent-code",
        status: "terminal",
        idempotencyKey: "run-1:task-a:terminal",
        startedAt: "2026-07-11T00:00:00.000Z",
        finishedAt: "2026-07-11T00:00:01.000Z",
        result: {
          semanticStatus: "succeeded",
          reason: "complete",
          outcomeSummary: "Completed before cancellation cleanup arrived",
          files: { touched: [], created: [], deleted: [], renamed: [] },
          verification: [],
          toolFailureSummary: [],
          unresolvedPermissions: [],
          agentId: "agent-code",
          chatId: "chat-terminal",
          startedAt: "2026-07-11T00:00:00.000Z",
          finishedAt: "2026-07-11T00:00:01.000Z",
        },
      },
    ];
    const persisted = SupervisorRunStateSchema.parse(run);
    const harness = createHarness({
      run: persisted,
      stopError: new NotFoundError("Chat not found", {
        module: "session",
        op: "session.lifecycle.stop",
        details: { chatId: "chat-terminal" },
      }),
    });
    const before = await harness.runs.get("run-1", "user-1");

    await harness.service.stop({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      attemptId: "attempt-terminal",
    });

    const after = await harness.runs.get("run-1", "user-1");
    expect(harness.stopped).toEqual(["chat-terminal"]);
    expect(after).toEqual(before);
    expect(after?.tasks[0]?.attempts[0]).toMatchObject({
      status: "terminal",
      result: {
        semanticStatus: "succeeded",
        outcomeSummary: "Completed before cancellation cleanup arrived",
      },
    });
  });

  test("does not swallow a session not-found for a different persisted chat", async () => {
    const run = createWorkerRun();
    const task = run.tasks[0];
    if (!task) {
      throw new Error("Expected worker task");
    }
    task.attempts = [
      {
        attemptId: "attempt-running",
        chatId: "chat-expected",
        agentId: "agent-code",
        status: "running",
        idempotencyKey: "run-1:task-a:running",
        startedAt: "2026-07-11T00:00:00.000Z",
      },
    ];
    const error = new NotFoundError("Chat not found", {
      module: "session",
      op: "session.lifecycle.stop",
      details: { chatId: "chat-different" },
    });
    const harness = createHarness({ run, stopError: error });

    await expect(
      harness.service.stop({
        runId: "run-1",
        userId: "user-1",
        taskId: "task-a",
        attemptId: "attempt-running",
      })
    ).rejects.toBe(error);

    const after = await harness.runs.get("run-1", "user-1");
    expect(after?.tasks[0]?.attempts[0]?.status).toBe("running");
    expect(harness.stopped).toEqual(["chat-expected"]);
  });

  test("marks a reserved attempt interrupted and fails the task when creation fails", async () => {
    const harness = createHarness({ createFails: true });
    await expect(
      harness.service.dispatch({
        runId: "run-1",
        userId: "user-1",
        taskId: "task-a",
        idempotencyKey: "run-1:task-a:1",
        preparedPrompt: await harness.prepareDispatchPrompt(
          "task-a",
          "effect-create-failure"
        ),
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
      preparedPrompt: await harness.prepareDispatchPrompt(
        "task-a",
        "effect-binding"
      ),
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
      preparedPrompt: await compatible.prepareDispatchPrompt(
        "task-a",
        "effect-compatible-model"
      ),
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
        preparedPrompt: await mismatch.prepareDispatchPrompt(
          "task-a",
          "effect-model-mismatch"
        ),
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
      preparedPrompt: await harness.prepareDispatchPrompt(
        task.taskId,
        "effect-manager-model"
      ),
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
      preparedPrompt: await harness.preparePendingCapacityPrompt(
        task.taskId,
        "effect-capacity-first-turn"
      ),
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
      preparedPrompt: await harness.preparePendingCapacityPrompt(
        task.taskId,
        "effect-capacity-resume"
      ),
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

    const preparedPrompt = await harness.prepareResumePrompt(
      task.taskId,
      "effect-exact-resume"
    );
    await harness.service.resume({
      runId: "run-1",
      userId: "user-1",
      taskId: task.taskId,
      attemptId: "attempt-recovery",
      preparedPrompt,
    });

    expect(harness.created).toHaveLength(0);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]?.chatId).toBe("chat-recovery");
    expect(harness.sent[0]?.source).toBe("orchestrator");
    expect(harness.sent[0]?.text).toContain("Continue the current task");
    expect(harness.sent[0]?.text).not.toContain("compact JSON object");
    expect(harness.sent[0]?.workflow).toEqual({
      effectId: "effect-exact-resume",
      authorityId: "authority-worker-test",
      runId: "run-1",
      owner: "worker",
      workItemId: task.taskId,
      attemptId: "attempt-recovery",
      promptHash: preparedPrompt.promptHash,
    });
    const run = await harness.runs.get("run-1", "user-1");
    expect(run?.tasks[0]?.attempts[0]?.turnId).toBe("turn-1");
  });

  test("surfaces an uncertain ACK without reclassifying a capacity resume", async () => {
    const base = createWorkerRun();
    const task = base.tasks[0];
    if (!task) {
      throw new Error("Expected worker fixture task");
    }
    const uncertain = new WorkflowEffectUncertainError({
      code: "ACP_PROMPT_ACK_UNCERTAIN",
      effectId: "effect-capacity-uncertain",
    });
    let capacityCalls = 0;
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
                attemptId: "attempt-capacity-uncertain",
                chatId: "chat-capacity-uncertain",
                agentId: task.preferredAgentId ?? "agent-code",
                agentSessionId: "acp-session-capacity-uncertain",
                status: "running",
                turnId: "turn-before-uncertain-ack",
                idempotencyKey: "run-1:task-a:1",
                startedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      dispatchError: uncertain,
      capacity: {
        suspendWorker: () => {
          capacityCalls += 1;
          return Promise.resolve({ suspended: true, run: base });
        },
      },
    });
    const preparedPrompt = await harness.preparePendingCapacityPrompt(
      task.taskId,
      "effect-capacity-uncertain"
    );

    await expect(
      harness.service.resumePendingCapacity({
        runId: "run-1",
        userId: "user-1",
        taskId: task.taskId,
        attemptId: "attempt-capacity-uncertain",
        preparedPrompt,
      })
    ).rejects.toBe(uncertain);
    expect(capacityCalls).toBe(0);
    expect(harness.sent[0]?.workflow).toEqual({
      effectId: "effect-capacity-uncertain",
      authorityId: "authority-worker-test",
      runId: "run-1",
      owner: "worker",
      workItemId: task.taskId,
      attemptId: "attempt-capacity-uncertain",
      promptHash: preparedPrompt.promptHash,
    });
    const run = await harness.runs.get("run-1", "user-1");
    expect(run?.tasks[0]?.attempts[0]?.turnId).toBe(
      "turn-before-uncertain-ack"
    );
  });

  test("keeps prepared-prompt validation failures outside the uncertain ACK boundary", async () => {
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
                attemptId: "attempt-invalid-prompt",
                chatId: "chat-invalid-prompt",
                agentId: task.preferredAgentId ?? "agent-code",
                agentSessionId: "acp-session-invalid-prompt",
                status: "running",
                turnId: "turn-before-invalid-prompt",
                idempotencyKey: "run-1:task-a:1",
                startedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });
    const preparedPrompt = await harness.prepareResumePrompt(
      task.taskId,
      "effect-invalid-prompt"
    );

    try {
      await harness.service.resume({
        runId: "run-1",
        userId: "user-1",
        taskId: task.taskId,
        attemptId: "attempt-invalid-prompt",
        preparedPrompt: {
          ...preparedPrompt,
          text: `${preparedPrompt.text}\nmutation after preparation`,
        },
      });
      throw new Error("Expected prepared prompt validation to fail");
    } catch (error) {
      expect(error).not.toBeInstanceOf(WorkflowEffectUncertainError);
      expect(String(error)).toContain(
        "Prepared Supervisor prompt does not match its canonical snapshot"
      );
    }
    expect(harness.sent).toHaveLength(0);
  });
});
