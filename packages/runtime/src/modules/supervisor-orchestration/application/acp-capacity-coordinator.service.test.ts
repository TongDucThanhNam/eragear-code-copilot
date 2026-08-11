import { describe, expect, test } from "bun:test";
import type { EventBusPort } from "#runtime/shared/ports/event-bus.port";
import type { SupervisorRunState } from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { AcpCapacityCoordinator } from "./acp-capacity-coordinator.service";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";

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
            idempotencyKey: "run-1:task-a:1",
            startedAt: "2026-08-10T10:00:00.000Z",
          },
        ],
      },
    ],
  });
}

describe("AcpCapacityCoordinator", () => {
  test("suspends without consuming the attempt and exact-resumes the same binding", async () => {
    const repo = new MemoryRuns(runningFixture());
    const calls: string[] = [];
    const events: string[] = [];
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        stop: (_userId, chatId) => {
          calls.push(`stop:${chatId}`);
          return Promise.resolve();
        },
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

    const resumed = await coordinator.resumeDue({
      now: "2026-08-10T10:01:30.000Z",
    });
    const final = await repo.get("run-1", "user-1");
    expect(resumed).toEqual({ resumed: 1, failedClosed: 0 });
    expect(final?.tasks[0]?.attempts).toHaveLength(1);
    expect(final?.tasks[0]?.attempts[0]?.status).toBe("running");
    expect(calls).toEqual(["stop:chat-1", "exact:chat-1"]);
    expect(events).toEqual([
      "supervisor_capacity_suspended",
      "supervisor_capacity_resumed",
    ]);
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
        stop: (_userId, chatId) => {
          calls.push(`stop:${chatId}`);
          return Promise.resolve();
        },
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
    expect(calls).toEqual(["stop:manager-chat-1", "exact:manager-chat-1"]);
  });

  test("exact-resume failure creates a durable user decision", async () => {
    const repo = new MemoryRuns(runningFixture());
    const coordinator = new AcpCapacityCoordinator({
      runs: repo,
      sessions: {
        stop: () => Promise.resolve(),
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
    expect(final?.status).toBe("needs_user");
    expect(final?.decisions[0]?.kind).toBe("exact_resume_failed");
  });
});
