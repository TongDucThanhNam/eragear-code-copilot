import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { ENV } from "#runtime/config/environment";
import {
  GoalIntakeRevisionConflictError,
  type GoalIntakeState,
} from "#runtime/modules/goal-intake";
import { GoalIntakeSqliteWorkerRepository } from "#runtime/modules/goal-intake/di";
import { createSupervisorRunFixture } from "#runtime/modules/supervisor-orchestration/domain/supervisor-run.test-fixture";
import { WorkflowJournalSqliteWorkerAdapter } from "#runtime/modules/workflow/di";
import type {
  SqliteWorkerRequest,
  SqliteWorkerResponse,
} from "./sqlite-worker.protocol";
import {
  callSqliteWorker,
  getSqliteWorkerStats,
  initializeSqliteWorker,
  resetSqliteWorkerClientForTests,
  setSqliteWorkerFactoryForTests,
  stopSqliteWorker,
} from "./sqlite-worker-client";

const WORKER_TIMEOUT_RE = /timed out/i;

class FakeWorker extends EventEmitter {
  terminated = false;
  private readonly respond: (
    request: SqliteWorkerRequest,
    worker: FakeWorker
  ) => void;

  constructor(
    respond: (request: SqliteWorkerRequest, worker: FakeWorker) => void
  ) {
    super();
    this.respond = respond;
    queueMicrotask(() => {
      this.emit("message", { type: "ready" });
    });
  }

  postMessage(request: SqliteWorkerRequest): void {
    this.respond(request, this);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    this.emit("exit", 0);
    return Promise.resolve(0);
  }
}

describe("sqlite-worker-client", () => {
  const originalWorkerEnabled = ENV.sqliteWorkerEnabled;
  const originalRequestTimeoutMs = ENV.sqliteWorkerRequestTimeoutMs;

  afterEach(async () => {
    ENV.sqliteWorkerEnabled = originalWorkerEnabled;
    ENV.sqliteWorkerRequestTimeoutMs = originalRequestTimeoutMs;
    await stopSqliteWorker();
    setSqliteWorkerFactoryForTests(null);
    resetSqliteWorkerClientForTests();
  });

  test("recycles worker after timeout and allows next write request", async () => {
    ENV.sqliteWorkerEnabled = true;
    ENV.sqliteWorkerRequestTimeoutMs = 10;

    const workers: FakeWorker[] = [];
    setSqliteWorkerFactoryForTests((_entryPath, _initData) => {
      const index = workers.length;
      if (index === 0) {
        const worker = new FakeWorker(() => {
          // Intentionally do not reply to trigger timeout + recycle.
        });
        workers.push(worker);
        return worker as unknown as Worker;
      }

      const worker = new FakeWorker((request, emitter) => {
        const response: SqliteWorkerResponse = {
          type: "response",
          id: request.id,
          ok: true,
          result: { ok: true },
        };
        setTimeout(() => {
          emitter.emit("message", response);
        }, 0);
      });
      workers.push(worker);
      return worker as unknown as Worker;
    });

    await initializeSqliteWorker([process.cwd()]);

    await expect(
      callSqliteWorker("storage", "getStorageStats", [])
    ).rejects.toThrow(WORKER_TIMEOUT_RE);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(workers[0]?.terminated).toBe(true);
    expect(getSqliteWorkerStats().timeoutCount).toBe(1);
    expect(getSqliteWorkerStats().recycleCount).toBe(1);
    expect(getSqliteWorkerStats().lastRecycleReason).toBe("request_timeout");

    await expect(
      callSqliteWorker("storage", "getStorageStats", [])
    ).resolves.toEqual({ ok: true });
    expect(workers.length).toBe(2);
  });

  test("routes workflow journal repository calls through its worker service", async () => {
    ENV.sqliteWorkerEnabled = true;
    ENV.sqliteWorkerRequestTimeoutMs = 1000;

    const requests: SqliteWorkerRequest[] = [];
    setSqliteWorkerFactoryForTests(
      (_entryPath, _initData) =>
        new FakeWorker((request, emitter) => {
          requests.push(request);
          const response: SqliteWorkerResponse = {
            type: "response",
            id: request.id,
            ok: true,
            result: request.method === "getEvent" ? null : [],
          };
          queueMicrotask(() => {
            emitter.emit("message", response);
          });
        }) as unknown as Worker
    );
    await initializeSqliteWorker([process.cwd()]);

    const journal = new WorkflowJournalSqliteWorkerAdapter();
    await expect(journal.getEvent("event-1")).resolves.toBeNull();
    await expect(
      journal.releasePendingEffectClaims({ nowMs: 99 })
    ).resolves.toEqual([]);
    await expect(
      journal.markStaleStartedDispatchesUncertain({
        effectTypes: ["start_turn", "resume_session"],
        nowMs: 100,
        error: { code: "DISPATCH_ACK_UNKNOWN" },
        includeUnexpired: true,
      })
    ).resolves.toEqual([]);
    const snapshot = createSupervisorRunFixture({ runId: "run-worker-uow" });
    const transition = {
      expectedRevision: null,
      snapshot,
      event: {
        eventId: "event-worker-uow-0",
        runId: snapshot.runId,
        revision: snapshot.revision,
        eventType: "supervisor_run_created",
        payloadVersion: 1,
        payload: { runId: snapshot.runId },
        occurredAtMs: Date.parse(snapshot.updatedAt),
      },
      effects: [],
    };
    await journal.commitRunTransition(transition);
    await expect(
      journal.cancelPendingEffects({
        runId: snapshot.runId,
        authorityId: "goal-revision-1",
        cancelledAtMs: 101,
      })
    ).resolves.toEqual([]);
    expect(
      requests.map(({ service, method, args }) => ({ service, method, args }))
    ).toEqual([
      {
        service: "workflowJournal",
        method: "getEvent",
        args: ["event-1"],
      },
      {
        service: "workflowJournal",
        method: "releasePendingEffectClaims",
        args: [{ nowMs: 99 }],
      },
      {
        service: "workflowJournal",
        method: "markStaleStartedDispatchesUncertain",
        args: [
          {
            effectTypes: ["start_turn", "resume_session"],
            nowMs: 100,
            error: { code: "DISPATCH_ACK_UNKNOWN" },
            includeUnexpired: true,
          },
        ],
      },
      {
        service: "workflowJournal",
        method: "commitRunTransition",
        args: [transition],
      },
      {
        service: "workflowJournal",
        method: "cancelPendingEffects",
        args: [
          {
            runId: snapshot.runId,
            authorityId: "goal-revision-1",
            cancelledAtMs: 101,
          },
        ],
      },
    ]);
  });

  test("preserves workflow conflict codes across the worker protocol", async () => {
    ENV.sqliteWorkerEnabled = true;
    ENV.sqliteWorkerRequestTimeoutMs = 1000;
    setSqliteWorkerFactoryForTests(
      (_entryPath, _initData) =>
        new FakeWorker((request, emitter) => {
          const response: SqliteWorkerResponse = {
            type: "response",
            id: request.id,
            ...(request.service === "storage" && request.method === "shutdown"
              ? { ok: true, result: undefined }
              : {
                  ok: false,
                  error: {
                    name: "WorkflowJournalConflictError",
                    message: "authority-scoped idempotency conflict",
                    code: "WORKFLOW_JOURNAL_CONFLICT",
                  },
                }),
          };
          queueMicrotask(() => {
            emitter.emit("message", response);
          });
        }) as unknown as Worker
    );
    await initializeSqliteWorker([process.cwd()]);

    const journal = new WorkflowJournalSqliteWorkerAdapter();
    const snapshot = createSupervisorRunFixture({
      runId: "run-worker-conflict",
    });
    await expect(
      journal.commitRunTransition({
        expectedRevision: null,
        snapshot,
        event: {
          eventId: "event-worker-conflict-0",
          runId: snapshot.runId,
          revision: snapshot.revision,
          eventType: "supervisor_run_created",
          payloadVersion: 1,
          payload: { runId: snapshot.runId },
          occurredAtMs: Date.parse(snapshot.updatedAt),
        },
      })
    ).rejects.toMatchObject({
      name: "WorkflowJournalConflictError",
      code: "WORKFLOW_JOURNAL_CONFLICT",
    });
  });

  test("routes goal intake writes and rehydrates revision conflicts", async () => {
    ENV.sqliteWorkerEnabled = true;
    ENV.sqliteWorkerRequestTimeoutMs = 1000;
    const requests: SqliteWorkerRequest[] = [];
    setSqliteWorkerFactoryForTests(
      (_entryPath, _initData) =>
        new FakeWorker((request, emitter) => {
          requests.push(request);
          const response: SqliteWorkerResponse = {
            type: "response",
            id: request.id,
            ...(request.service === "storage" && request.method === "shutdown"
              ? { ok: true, result: undefined }
              : {
                  ok: false,
                  error: {
                    name: "GoalIntakeRevisionConflictError",
                    message:
                      "Goal intake intake-worker revision changed: expected 0, actual 1",
                    code: "GOAL_INTAKE_REVISION_CONFLICT",
                    intakeId: "intake-worker",
                    expectedRevision: 0,
                    actualRevision: 1,
                  },
                }),
          };
          queueMicrotask(() => {
            emitter.emit("message", response);
          });
        }) as unknown as Worker
    );
    await initializeSqliteWorker([process.cwd()]);

    const repository = new GoalIntakeSqliteWorkerRepository();
    const state = { intakeId: "intake-worker" } as GoalIntakeState;
    const save = repository.save(state, 0);
    await expect(save).rejects.toBeInstanceOf(GoalIntakeRevisionConflictError);
    await expect(save).rejects.toMatchObject({
      intakeId: "intake-worker",
      expectedRevision: 0,
      actualRevision: 1,
    });
    expect(requests[0]).toMatchObject({
      service: "goalIntake",
      method: "save",
      args: [state, 0],
    });
  });
});
