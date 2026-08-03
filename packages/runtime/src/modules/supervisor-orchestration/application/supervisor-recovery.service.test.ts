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
  sessionState: SupervisorRecoverySessionState
) {
  const runs = new MemoryRuns(run);
  const resumed: string[] = [];
  const disposed: string[] = [];
  const scheduled: string[] = [];
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
    },
    () => "2026-07-11T00:02:00.000Z"
  );
  return { service, runs, resumed, disposed, scheduled };
}

describe("SupervisorRecoveryService", () => {
  test("preserves paused runs without resuming their workers", async () => {
    const run = createSupervisorRunFixture({
      status: "paused",
      tasks: [activeTask()],
    });
    const harness = createHarness(run, {
      status: "stopped",
      resumable: true,
    });

    const summary = await harness.service.reconcile();

    expect(summary.paused).toBe(1);
    expect(harness.resumed).toEqual([]);
    expect((await harness.runs.get(run.runId, run.userId))?.status).toBe(
      "paused"
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
    });
    expect((await live.service.reconcile()).live).toBe(1);
    expect(live.scheduled).toEqual([liveRun.runId]);

    const stoppedRun = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const stopped = createHarness(stoppedRun, {
      status: "stopped",
      resumable: true,
    });
    expect((await stopped.service.reconcile()).resumed).toBe(1);
    expect(stopped.resumed).toEqual(["attempt-1"]);
  });

  test("cleans non-resumable workers and retries within budget", async () => {
    const run = createSupervisorRunFixture({
      status: "running",
      tasks: [activeTask()],
    });
    const harness = createHarness(run, {
      status: "missing",
      resumable: false,
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
    });

    await harness.service.reconcile();
    const recovered = await harness.runs.get(run.runId, run.userId);

    expect(recovered?.status).toBe("needs_user");
    expect(recovered?.tasks[0]?.status).toBe("needs_user");
    expect(harness.scheduled).toEqual([]);
  });
});
