import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { ENV } from "@/config/environment";
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

describe("sqlite-worker-client timeout recovery", () => {
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
});
