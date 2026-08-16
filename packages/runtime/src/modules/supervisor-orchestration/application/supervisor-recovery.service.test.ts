import { describe, expect, test } from "bun:test";
import type {
  SupervisorRunState,
  SupervisorTaskRecord,
} from "../domain/supervisor-run.schemas";
import { createSupervisorRunFixture } from "../domain/supervisor-run.test-fixture";
import { SupervisorRunRevisionConflictError } from "../domain/supervisor-run.transitions";
import type { SupervisorRecoverySessionState } from "./ports/supervisor-recovery.port";
import type { SupervisorRunRepositoryPort } from "./ports/supervisor-run-repository.port";
import { SupervisorRecoveryService } from "./supervisor-recovery.service";

class MemoryRuns implements SupervisorRunRepositoryPort {
  private run: SupervisorRunState;

  constructor(run: SupervisorRunState) {
    this.run = structuredClone(run);
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

  list(input: { userId: string }) {
    return Promise.resolve(
      input.userId === this.run.userId ? [structuredClone(this.run)] : []
    );
  }

  listNonTerminal() {
    return Promise.resolve([structuredClone(this.run)]);
  }

  save(run: SupervisorRunState, expectedRevision: number) {
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

function activeTask(
  attemptCount = 1,
  status: SupervisorTaskRecord["status"] = "running"
): SupervisorTaskRecord {
  const task = createSupervisorRunFixture().tasks[0];
  if (!task) {
    throw new Error("Task fixture missing");
  }
  return {
    ...task,
    status,
    attempts: Array.from({ length: attemptCount }, (_, index) => ({
      attemptId: `attempt-${index + 1}`,
      chatId: `chat-${index + 1}`,
      agentId: "agent-1",
      status: index === attemptCount - 1 ? "running" : "interrupted",
      idempotencyKey: `attempt-key-${index + 1}`,
      startedAt: "2026-07-11T00:00:00.000Z",
      ...(index < attemptCount - 1
        ? { finishedAt: "2026-07-11T00:00:30.000Z" }
        : {}),
      workspace: {
        workspaceId: `workspace-${index + 1}`,
        kind: "isolated_git" as const,
        userProjectRoot: "C:/repo",
        projectRoot: `C:/runtime/worktree-${index + 1}`,
        baseHead: "abc123",
        targetFingerprints: {},
      },
    })),
  };
}

function createHarness(
  run: SupervisorRunState,
  sessionState: SupervisorRecoverySessionState,
  options: { recoverManagerTurn?: boolean; claimError?: Error } = {}
) {
  const runs = new MemoryRuns(run);
  const resumed: string[] = [];
  const disposed: string[] = [];
  const claimed: string[] = [];
  const scheduled: string[] = [];
  const managerTurns: string[] = [];
  const service = new SupervisorRecoveryService(
    runs,
    { inspect: () => Promise.resolve(sessionState) },
    {
      resume(input) {
        resumed.push(input.attemptId);
        return Promise.resolve();
      },
    },
    {
      claim(workspace) {
        if (options.claimError) {
          return Promise.reject(options.claimError);
        }
        claimed.push(workspace.workspaceId);
        return Promise.resolve();
      },
      dispose(workspace) {
        disposed.push(workspace.workspaceId);
        return Promise.resolve();
      },
    },
    {
      schedule(runId) {
        scheduled.push(runId);
        return runs.get(runId, run.userId).then((value) => value as never);
      },
      recordWorkerResult() {
        throw new Error("not expected");
      },
      recordManagerTurn(input) {
        managerTurns.push(input.runId);
        return runs
          .get(input.runId, run.userId)
          .then((value) => value as never);
      },
    },
    options.recoverManagerTurn
      ? {
          recoverCompletedTurn() {
            return Promise.resolve({
              runId: run.runId,
              userId: run.userId,
              turnId: "manager-turn-1",
              turn: {
                schemaVersion: 1 as const,
                kind: "question" as const,
                decisionKind: "classifier_uncertain" as const,
                prompt: "Choose a direction",
              },
            });
          },
        }
      : undefined,
    () => "2026-07-11T00:02:00.000Z"
  );
  return {
    service,
    runs,
    resumed,
    claimed,
    disposed,
    scheduled,
    managerTurns,
  };
}

describe("SupervisorRecoveryService", () => {
  test("recovers a completed persisted manager turn after its ACP process stopped", async () => {
    const run = createSupervisorRunFixture({
      status: "planning",
      tasks: [],
      managerSession: {
        agentId: "agent-1",
        chatId: "manager-chat-1",
        agentSessionId: "agent-session-1",
        status: "running",
        exactResumeRequired: true,
        activeTurn: {
          turnId: "manager-turn-1",
          kind: "plan",
          startedAt: "2026-07-11T00:00:00.000Z",
        },
      },
    });
    const harness = createHarness(
      run,
      { status: "stopped", resumable: true, promptActive: false },
      { recoverManagerTurn: true }
    );

    const summary = await harness.service.reconcile();

    expect(summary.resumed).toBe(1);
    expect(harness.managerTurns).toEqual([run.runId]);
  });

  test("preserves paused runs without resuming their workers", async () => {
    const run = createSupervisorRunFixture({
      status: "paused",
      tasks: [activeTask()],
    });
    const harness = createHarness(run, {
      status: "stopped",
      resumable: true,
      promptActive: false,
    });

    const summary = await harness.service.reconcile();

    expect(summary.paused).toBe(1);
    expect(harness.claimed).toEqual(["workspace-1"]);
    expect(harness.resumed).toEqual([]);
    expect((await harness.runs.get(run.runId, run.userId))?.status).toBe(
      "paused"
    );
  });

  test("reclaims a capacity-waiting writer before quota resume", async () => {
    const task = activeTask(1, "waiting_capacity");
    const attempt = task.attempts[0];
    if (!attempt) {
      throw new Error("Attempt fixture missing");
    }
    attempt.status = "waiting_capacity";
    const run = createSupervisorRunFixture({
      status: "waiting_capacity",
      tasks: [task],
      capacityWaits: [
        {
          waitId: "wait-1",
          owner: "task",
          taskId: task.taskId,
          attemptId: attempt.attemptId,
          agentId: attempt.agentId,
          kind: "quota_exhausted",
          reason: "Quota resets later",
          suspendedAt: "2026-07-11T00:01:00.000Z",
          retryAt: "2026-07-11T01:00:00.000Z",
          backoffStep: 0,
        },
      ],
    });
    const harness = createHarness(run, {
      status: "stopped",
      resumable: true,
      promptActive: false,
    });

    const summary = await harness.service.reconcile();

    expect(summary).toMatchObject({ runs: 1, resumed: 0, interrupted: 0 });
    expect(harness.claimed).toEqual(["workspace-1"]);
    expect(harness.resumed).toEqual([]);
    expect((await harness.runs.get(run.runId, run.userId))?.status).toBe(
      "waiting_capacity"
    );
  });

  test("keeps live workers and resumes stopped capable sessions", async () => {
    const liveRun = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const live = createHarness(liveRun, {
      status: "running",
      resumable: false,
      promptActive: true,
    });
    expect((await live.service.reconcile()).live).toBe(1);
    expect(live.claimed).toEqual(["workspace-1"]);
    expect(live.scheduled).toEqual([liveRun.runId]);

    const stoppedRun = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const stopped = createHarness(stoppedRun, {
      status: "stopped",
      resumable: true,
      promptActive: false,
    });
    expect((await stopped.service.reconcile()).resumed).toBe(1);
    expect(stopped.resumed).toEqual(["attempt-1"]);
    expect(stopped.claimed).toEqual(["workspace-1"]);

    const idleRun = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const idle = createHarness(idleRun, {
      status: "running",
      resumable: true,
      promptActive: false,
    });
    expect((await idle.service.reconcile()).resumed).toBe(1);
    expect(idle.resumed).toEqual(["attempt-1"]);
  });

  test("fails a recovered writer closed when its direct workspace cannot be reclaimed", async () => {
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const harness = createHarness(
      run,
      { status: "running", resumable: true, promptActive: true },
      { claimError: new Error("repository already claimed") }
    );

    const summary = await harness.service.reconcile();
    const recovered = await harness.runs.get(run.runId, run.userId);

    expect(summary).toMatchObject({ interrupted: 1, cleaned: 1, live: 0 });
    expect(recovered?.tasks[0]?.attempts[0]?.status).toBe("interrupted");
    expect(harness.resumed).toEqual([]);
  });

  test("cleans non-resumable workers and retries within budget", async () => {
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const harness = createHarness(run, {
      status: "missing",
      resumable: false,
      promptActive: false,
    });

    const summary = await harness.service.reconcile();
    const recovered = await harness.runs.get(run.runId, run.userId);

    expect(summary).toMatchObject({ interrupted: 1, cleaned: 1 });
    expect(recovered?.tasks[0]?.attempts[0]?.status).toBe("interrupted");
    expect(recovered?.tasks[0]?.status).toBe("ready");
    expect(harness.scheduled).toEqual([run.runId]);
  });

  test("fails closed when a non-resumable worker exhausted its attempts", async () => {
    const run = createSupervisorRunFixture({
      status: "running",
      limits: {
        ...createSupervisorRunFixture().limits,
        maxAttemptsPerTask: 2,
      },
      tasks: [activeTask(2)],
    });
    const harness = createHarness(run, {
      status: "missing",
      resumable: false,
      promptActive: false,
    });

    await harness.service.reconcile();
    const recovered = await harness.runs.get(run.runId, run.userId);

    expect(recovered?.status).toBe("needs_user");
    expect(recovered?.tasks[0]?.status).toBe("needs_user");
    expect(harness.scheduled).toEqual([]);
  });
});
