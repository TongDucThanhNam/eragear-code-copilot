import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { AcpCapacityCoordinator } from "./acp-capacity-coordinator.service";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import { SupervisorSchedulerService } from "./supervisor-scheduler.service";

class MemoryRuns implements SupervisorRunRepositoryPort {
  private run: SupervisorRunState;

  constructor(run: SupervisorRunState) {
    this.run = run;
  }
  create(run: SupervisorRunState) {
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }
  get(runId: string, userId: string) {
    return Promise.resolve(
      this.run.runId === runId && this.run.userId === userId
        ? structuredClone(this.run)
        : null
    );
  }
  list() {
    return Promise.resolve([structuredClone(this.run)]);
  }
  listNonTerminal() {
    return Promise.resolve([structuredClone(this.run)]);
  }
  save(run: SupervisorRunState, expectedRevision: number) {
    if (this.run.revision !== expectedRevision) {
      throw new Error("revision conflict");
    }
    this.run = structuredClone(run);
    return Promise.resolve(structuredClone(run));
  }
}

function runningFixture(): SupervisorRunState {
  const base = createSupervisorRunFixture();
  const task = base.tasks[0];
  if (!task) {
    throw new Error("fixture task missing");
  }
  return createSupervisorRunFixture({
    status: "running",
    tasks: [
      {
        ...task,
        status: "running",
        attempts: [
          {
            attemptId: "attempt-1",
            chatId: "chat-1",
            agentSessionId: "acp-session-1",
            agentId: "agent-1",
            isolatedProjectRoot: "C:/worktrees/attempt-1",
            status: "running",
            turnId: "turn-1",
            idempotencyKey: "run-1:task-a:1",
            startedAt: "2026-08-10T10:00:00.000Z",
          },
        ],
      },
    ],
  });
}

function runningFixtureWithIndependentTask(): SupervisorRunState {
  const run = runningFixture();
  const independent = createSupervisorRunFixture().tasks[0];
  if (!independent) {
    throw new Error("fixture task missing");
  }
  run.tasks.push({
    ...independent,
    taskId: "task-independent",
    title: "Independent work",
    goal: "Continue independently",
    dependencies: [],
  });
  return run;
}

describe("AcpCapacityCoordinator", () => {
  test("persists suspension without stopping outside the workflow and exact-resumes the same binding", async () => {
    const repo = new MemoryRuns(runningFixture());
    const calls: string[] = [];
    const events: string[] = [];
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        resumeExact: (_userId, chatId) => {
          calls.push(`exact:${chatId}`);
          return Promise.resolve();
        },
      },
      eventBus: {
        subscribe: () => () => undefined,
        publish: (event) => {
          events.push(event.type);
          return Promise.resolve();
        },
      } satisfies EventBusPort,
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });

    const suspended = await coordinator.suspendWorker({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      attemptId: "attempt-1",
      failure: { error: new Error("quota exhausted") },
    });
    expect(suspended.run.status).toBe("waiting_capacity");
    expect(suspended.run.tasks[0]?.attempts).toHaveLength(1);
    expect(suspended.run.tasks[0]?.attempts[0]).toMatchObject({
      attemptId: "attempt-1",
      chatId: "chat-1",
      agentSessionId: "acp-session-1",
      isolatedProjectRoot: "C:/worktrees/attempt-1",
      status: "waiting_capacity",
    });
    expect(suspended.run.tasks[0]?.attempts[0]?.turnId).toBe("turn-1");

    const resumed = await coordinator.resumeDue({
      now: "2026-08-10T10:00:30.000Z",
      forceDue: true,
    });
    const final = await repo.get("run-1", "user-1");
    expect(resumed).toEqual({ resumed: 1, failedClosed: 0 });
    expect(final?.tasks[0]?.attempts).toHaveLength(1);
    expect(final?.tasks[0]?.attempts[0]?.status).toBe("running");
    expect(final?.audit.at(-1)).toMatchObject({
      kind: "capacity_resumed",
      createdAt: "2026-08-10T10:00:30.000Z",
    });
    expect(calls).toEqual(["exact:chat-1"]);
    expect(events).toEqual([
      "supervisor_capacity_suspended",
      "supervisor_capacity_resumed",
    ]);
  });

  test("polls quota, suspends once, and leaves durable resumption to the workflow runtime", async () => {
    const repo = new MemoryRuns(runningFixture());
    const calls: string[] = [];
    let quotaCalls = 0;
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        resumeExact: (_userId, chatId) => {
          calls.push(`exact:${chatId}`);
          return Promise.resolve();
        },
        getModelId: () => "zai-coding-plan/glm-5.2",
      },
      quota: {
        refresh: () => {
          quotaCalls += 1;
          return Promise.resolve({
            providers: [
              {
                providerId: "zai",
                displayName: "Z.ai Coding Plan",
                status: "ready" as const,
                windows: [
                  {
                    label: "5h",
                    percentRemaining: quotaCalls === 1 ? 0 : 100,
                    resetAt: "2026-08-10T12:00:00.000Z",
                  },
                ],
              },
            ],
          });
        },
      },
      eventBus: {
        subscribe: () => () => undefined,
        publish: () => Promise.resolve(),
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
      quotaPollIntervalMs: 30_000,
    });

    expect(
      await coordinator.reconcileQuota({
        userIds: ["user-1"],
        now: "2026-08-10T10:00:00.000Z",
      })
    ).toEqual({
      checkedProviders: 1,
      suspendedWorkers: 1,
      suspendedManagers: 0,
    });
    const waiting = await repo.get("run-1", "user-1");
    expect(waiting?.capacityWaits[0]).toMatchObject({
      capacityGroup: "zai",
      resetAt: "2026-08-10T12:00:00.000Z",
    });
    expect(
      await coordinator.reconcileQuota({
        userIds: ["user-1"],
        now: "2026-08-10T10:00:05.000Z",
      })
    ).toEqual({
      checkedProviders: 0,
      suspendedWorkers: 0,
      suspendedManagers: 0,
    });
    expect(
      await coordinator.reconcileQuota({
        userIds: ["user-1"],
        now: "2026-08-10T10:00:31.000Z",
      })
    ).toEqual({
      checkedProviders: 1,
      suspendedWorkers: 0,
      suspendedManagers: 0,
    });
    expect(quotaCalls).toBe(2);
    expect(calls).toEqual([]);
    const final = await repo.get("run-1", "user-1");
    expect(final?.status).toBe("waiting_capacity");
    expect(final?.capacityWaits).toHaveLength(1);
    expect(final?.tasks[0]?.attempts[0]?.status).toBe("waiting_capacity");
  });

  test("keeps independent work dispatchable while a worker waits for capacity", async () => {
    const repo = new MemoryRuns(runningFixtureWithIndependentTask());
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        resumeExact: () => Promise.resolve(),
      },
      eventBus: {
        subscribe: () => () => undefined,
        publish: () => Promise.resolve(),
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });

    const suspended = await coordinator.suspendWorker({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      attemptId: "attempt-1",
      failure: { error: new Error("quota exhausted") },
    });

    expect(suspended.run.blockingDecisionId).toBeUndefined();
    expect(suspended.run.tasks[0]).toMatchObject({
      status: "waiting_capacity",
      activity: "capacity_wait",
    });
    expect(
      new SupervisorSchedulerService().evaluate(suspended.run).dispatchTaskIds
    ).toEqual(["task-independent"]);
  });

  test("keeps the sticky manager turn and exact-resumes it after quota", async () => {
    const repo = new MemoryRuns(
      createSupervisorRunFixture({
        status: "planning",
        managerSession: {
          agentId: "manager-1",
          chatId: "manager-chat-1",
          agentSessionId: "manager-acp-session-1",
          status: "running",
          exactResumeRequired: true,
          activeTurn: {
            turnId: "manager-turn-1",
            kind: "replan",
            startedAt: "2026-08-10T10:00:00.000Z",
          },
        },
      })
    );
    const calls: string[] = [];
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        resumeExact: (_userId, chatId) => {
          calls.push(`exact:${chatId}`);
          return Promise.resolve();
        },
      },
      eventBus: {
        subscribe: () => () => undefined,
        publish: () => Promise.resolve(),
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });

    const suspended = await coordinator.suspendManager({
      runId: "run-1",
      userId: "user-1",
      failure: { error: new Error("quota exhausted") },
    });
    expect(suspended.run.managerSession).toMatchObject({
      agentId: "manager-1",
      chatId: "manager-chat-1",
      agentSessionId: "manager-acp-session-1",
      status: "waiting_capacity",
      activeTurn: { turnId: "manager-turn-1", kind: "replan" },
    });
    expect(
      await coordinator.resumeDue({ now: "2026-08-10T10:02:00.000Z" })
    ).toEqual({ resumed: 1, failedClosed: 0 });

    const final = await repo.get("run-1", "user-1");
    expect(final?.status).toBe("planning");
    expect(final?.managerSession).toMatchObject({
      agentId: "manager-1",
      chatId: "manager-chat-1",
      agentSessionId: "manager-acp-session-1",
      status: "running",
      activeTurn: { turnId: "manager-turn-1", kind: "replan" },
    });
    expect(calls).toEqual(["exact:manager-chat-1"]);
  });

  test("does not let an executing manager capacity wait block approved work", async () => {
    const run = runningFixtureWithIndependentTask();
    run.managerSession = {
      agentId: "manager-1",
      chatId: "manager-chat-1",
      agentSessionId: "manager-acp-session-1",
      status: "running",
      exactResumeRequired: true,
      activeTurn: {
        turnId: "manager-turn-1",
        kind: "replan",
        startedAt: "2026-08-10T10:00:00.000Z",
      },
    };
    const repo = new MemoryRuns(run);
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        resumeExact: () => Promise.resolve(),
      },
      eventBus: {
        subscribe: () => () => undefined,
        publish: () => Promise.resolve(),
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });

    const suspended = await coordinator.suspendManager({
      runId: "run-1",
      userId: "user-1",
      failure: { error: new Error("quota exhausted") },
    });

    expect(suspended.run.phase).toBe("executing");
    expect(suspended.run.status).toBe("running");
    expect(suspended.run.blockingDecisionId).toBeUndefined();
    expect(
      new SupervisorSchedulerService().evaluate(suspended.run).dispatchTaskIds
    ).toEqual(["task-independent"]);

    await coordinator.resumeDue({ forceDue: true });
    const needsDecision = await coordinator.suspendManager({
      runId: "run-1",
      userId: "user-1",
      failure: { assistantFailure: "401 authentication required" },
    });
    expect(needsDecision.run.decisions.at(-1)?.kind).toBe(
      "classifier_uncertain"
    );
    expect(needsDecision.run.blockingDecisionId).toBeUndefined();
    expect(
      new SupervisorSchedulerService().evaluate(needsDecision.run)
        .dispatchTaskIds
    ).toEqual(["task-independent"]);
  });

  test("exact-resume failure creates a durable user decision", async () => {
    const run = runningFixtureWithIndependentTask();
    run.decisions.push({
      decisionId: "existing-resume-decision",
      kind: "exact_resume_failed",
      status: "open",
      prompt: "Existing exact-resume failure",
      createdAt: "2026-08-10T09:00:00.000Z",
    });
    const repo = new MemoryRuns(run);
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        resumeExact: () => Promise.reject(new Error("exact load failed")),
      },
      eventBus: {
        subscribe: () => () => undefined,
        publish: () => Promise.resolve(),
      },
      now: () => "2026-08-10T10:00:00.000Z",
      createId: (prefix) => `${prefix}-1`,
    });
    await coordinator.suspendWorker({
      runId: "run-1",
      userId: "user-1",
      taskId: "task-a",
      attemptId: "attempt-1",
      failure: { error: new Error("quota exhausted") },
    });
    expect(
      await coordinator.resumeDue({ now: "2026-08-10T10:02:00.000Z" })
    ).toEqual({ resumed: 0, failedClosed: 1 });
    const final = await repo.get("run-1", "user-1");
    expect(final?.status).toBe("running");
    expect(final?.decisions[0]?.kind).toBe("exact_resume_failed");
    expect(final?.tasks[0]?.blockingDecisionId).toBe(
      "existing-resume-decision"
    );
    expect(final?.blockingDecisionId).toBeUndefined();
    expect(
      final
        ? new SupervisorSchedulerService().evaluate(final).dispatchTaskIds
        : []
    ).toEqual(["task-independent"]);
  });
});
