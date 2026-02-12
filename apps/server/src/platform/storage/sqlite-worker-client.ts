import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import type { AppConfig } from "@/shared/types/settings.types";
import { toError } from "@/shared/utils/error.util";
import type {
  SqliteWorkerInitData,
  SqliteWorkerRequest,
  SqliteWorkerResponse,
  SqliteWorkerService,
} from "./sqlite-worker.protocol";
import { SQLITE_WORKER_KIND } from "./sqlite-worker.protocol";

const logger = createLogger("Storage");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type SqliteWorkerFactory = (
  entryPath: string,
  initData: SqliteWorkerInitData
) => Worker;

export interface SqliteWorkerHealthStats {
  recycleCount: number;
  timeoutCount: number;
  lastRecycleReason: string | null;
  lastRecycleAt: number | null;
}

const defaultSqliteWorkerFactory: SqliteWorkerFactory = (entryPath, initData) =>
  new Worker(entryPath, { workerData: initData });

let sqliteWorker: Worker | null = null;
let sqliteWorkerStartError: Error | null = null;
let sqliteWorkerRequestId = 0;
let sqliteWorkerAllowedRoots: string[] = [process.cwd()];
const pendingRequests = new Map<number, PendingRequest>();
let sqliteWorkerRecyclePromise: Promise<void> | null = null;
let sqliteWorkerFactory: SqliteWorkerFactory = defaultSqliteWorkerFactory;
const sqliteWorkerStats: SqliteWorkerHealthStats = {
  recycleCount: 0,
  timeoutCount: 0,
  lastRecycleReason: null,
  lastRecycleAt: null,
};

function normalizeRoots(roots: string[]): string[] {
  const normalized = roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  if (normalized.length === 0) {
    return [process.cwd()];
  }
  return [...new Set(normalized)];
}

function resolveWorkerEntrypointPath(): string {
  const runtimeDir = path.dirname(process.execPath);
  const fromDistRuntime = runtimeDir.includes(`${path.sep}dist`);
  const srcFromCwd = [
    path.join(
      process.cwd(),
      "src",
      "platform",
      "storage",
      "sqlite-worker.entry.ts"
    ),
  ];
  const distFromCwd = [
    path.join(
      process.cwd(),
      "dist",
      "platform",
      "storage",
      "sqlite-worker.entry.mjs"
    ),
    path.join(
      process.cwd(),
      "dist",
      "platform",
      "storage",
      "sqlite-worker.entry.js"
    ),
  ];
  const distFromRuntime = [
    path.join(runtimeDir, "platform", "storage", "sqlite-worker.entry.mjs"),
    path.join(runtimeDir, "platform", "storage", "sqlite-worker.entry.js"),
  ];
  const candidates = fromDistRuntime
    ? [...distFromRuntime, ...distFromCwd, ...srcFromCwd]
    : [...srcFromCwd, ...distFromCwd, ...distFromRuntime];
  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `[Storage] SQLite worker entrypoint not found. Tried: ${uniqueCandidates.join(", ")}`
  );
}

function rejectAllPending(error: Error): void {
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function recycleSqliteWorker(
  reason: string,
  cause: Error,
  workerOverride?: Worker
): Promise<void> {
  if (sqliteWorkerRecyclePromise) {
    return sqliteWorkerRecyclePromise;
  }

  const worker = workerOverride ?? sqliteWorker;
  if (!worker) {
    rejectAllPending(
      new Error(`[Storage] SQLite worker recycled after ${reason}`, { cause })
    );
    return Promise.resolve();
  }

  if (sqliteWorker === worker) {
    sqliteWorker = null;
  }
  sqliteWorkerStartError = null;
  sqliteWorkerStats.recycleCount += 1;
  sqliteWorkerStats.lastRecycleReason = reason;
  sqliteWorkerStats.lastRecycleAt = Date.now();
  rejectAllPending(
    new Error(`[Storage] SQLite worker recycled after ${reason}`, { cause })
  );

  sqliteWorkerRecyclePromise = worker
    .terminate()
    .then(() => {
      logger.warn("SQLite worker recycled", {
        reason,
        error: cause.message,
      });
    })
    .catch((error) => {
      logger.error(
        "Failed to terminate SQLite worker during recycle",
        toError(error, "Failed to terminate SQLite worker")
      );
    })
    .finally(() => {
      sqliteWorkerRecyclePromise = null;
    });

  return sqliteWorkerRecyclePromise;
}

function ensureSqliteWorker(): Worker {
  if (!ENV.sqliteWorkerEnabled) {
    throw new Error("[Storage] STORAGE_WORKER_ENABLED is false");
  }
  if (sqliteWorker) {
    return sqliteWorker;
  }
  if (sqliteWorkerStartError) {
    logger.warn("Retrying SQLite worker startup after previous failure", {
      error: sqliteWorkerStartError.message,
    });
    sqliteWorkerStartError = null;
  }

  try {
    const entryPath = resolveWorkerEntrypointPath();
    const initData: SqliteWorkerInitData = {
      kind: SQLITE_WORKER_KIND,
      allowedRoots: [...sqliteWorkerAllowedRoots],
    };
    const worker = sqliteWorkerFactory(entryPath, initData);

    worker.on("message", (raw: unknown) => {
      const message = raw as SqliteWorkerResponse;
      if (message?.type !== "response" || typeof message.id !== "number") {
        return;
      }

      const pending = pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(message.id);
      clearTimeout(pending.timer);

      if (message.ok) {
        pending.resolve(message.result);
        return;
      }

      const errorData = message.error;
      const error = new Error(
        errorData?.message ?? "SQLite worker request failed"
      );
      error.name = errorData?.name ?? "SqliteWorkerError";
      if (errorData?.stack) {
        error.stack = errorData.stack;
      }
      pending.reject(error);
    });

    worker.on("error", (error) => {
      logger.error("SQLite worker runtime error", error);
    });

    worker.on("exit", (code) => {
      if (sqliteWorker !== worker) {
        return;
      }

      const exitError = new Error(
        `[Storage] SQLite worker exited with code ${code}`
      );
      sqliteWorker = null;
      rejectAllPending(exitError);
      if (code !== 0) {
        logger.error("SQLite worker exited unexpectedly", exitError);
      }
    });

    sqliteWorker = worker;
    sqliteWorkerStartError = null;
    logger.info("SQLite worker started", { entryPath });
    return worker;
  } catch (error) {
    const startError = toError(error, "Failed to start SQLite worker");
    sqliteWorkerStartError = startError;
    throw startError;
  }
}

export function isSqliteWorkerEnabled(): boolean {
  return ENV.sqliteWorkerEnabled;
}

export function initializeSqliteWorker(allowedRoots: string[]): void {
  if (!ENV.sqliteWorkerEnabled) {
    return;
  }
  sqliteWorkerAllowedRoots = normalizeRoots(allowedRoots);
  ensureSqliteWorker();
}

export function configureSqliteWorkerAllowedRoots(
  allowedRoots: string[]
): Promise<void> {
  sqliteWorkerAllowedRoots = normalizeRoots(allowedRoots);
  return Promise.resolve();
}

function callSqliteWorkerOn<T>(
  worker: Worker,
  service: SqliteWorkerService,
  method: string,
  args: unknown[]
): Promise<T> {
  sqliteWorkerRequestId += 1;
  const requestId = sqliteWorkerRequestId;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = pendingRequests.get(requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(requestId);
      clearTimeout(pending.timer);
      const timeoutError = new Error(
        `[Storage] SQLite worker request timed out: ${service}.${method} (${ENV.sqliteWorkerRequestTimeoutMs}ms)`
      );
      sqliteWorkerStats.timeoutCount += 1;
      pending.reject(timeoutError);
      recycleSqliteWorker("request_timeout", timeoutError, worker).catch(
        (error) => {
          logger.error(
            "Failed to recycle SQLite worker after timeout",
            toError(error, "Failed to recycle SQLite worker")
          );
        }
      );
    }, ENV.sqliteWorkerRequestTimeoutMs);

    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });

    const request: SqliteWorkerRequest = {
      type: "request",
      id: requestId,
      service,
      method,
      args,
    };

    try {
      worker.postMessage(request);
    } catch (error) {
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(requestId);
      }
      reject(toError(error, "Failed to post message to SQLite worker"));
    }
  });
}

export function callSqliteWorker<T>(
  service: SqliteWorkerService,
  method: string,
  args: unknown[]
): Promise<T> {
  const worker = ensureSqliteWorker();
  return callSqliteWorkerOn(worker, service, method, args);
}

export async function updateSqliteWorkerRuntimeConfig(
  config: AppConfig
): Promise<void> {
  if (!ENV.sqliteWorkerEnabled) {
    return;
  }
  await callSqliteWorker("storage", "setRuntimeConfig", [config]);
}

export async function stopSqliteWorker(): Promise<void> {
  const worker = sqliteWorker;
  if (!worker) {
    sqliteWorkerStartError = null;
    return;
  }

  try {
    await callSqliteWorkerOn(worker, "storage", "shutdown", []);
  } catch (error) {
    logger.warn("SQLite worker shutdown request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    sqliteWorker = null;
    sqliteWorkerStartError = null;
    rejectAllPending(new Error("[Storage] SQLite worker stopped"));
    await worker.terminate();
  }
}

export function setSqliteWorkerFactoryForTests(
  factory: SqliteWorkerFactory | null
): void {
  sqliteWorkerFactory = factory ?? defaultSqliteWorkerFactory;
}

export function getSqliteWorkerStats(): SqliteWorkerHealthStats {
  return {
    recycleCount: sqliteWorkerStats.recycleCount,
    timeoutCount: sqliteWorkerStats.timeoutCount,
    lastRecycleReason: sqliteWorkerStats.lastRecycleReason,
    lastRecycleAt: sqliteWorkerStats.lastRecycleAt,
  };
}

export function resetSqliteWorkerClientForTests(): void {
  sqliteWorker = null;
  sqliteWorkerStartError = null;
  sqliteWorkerRequestId = 0;
  sqliteWorkerAllowedRoots = [process.cwd()];
  sqliteWorkerRecyclePromise = null;
  sqliteWorkerFactory = defaultSqliteWorkerFactory;
  sqliteWorkerStats.recycleCount = 0;
  sqliteWorkerStats.timeoutCount = 0;
  sqliteWorkerStats.lastRecycleReason = null;
  sqliteWorkerStats.lastRecycleAt = null;
  rejectAllPending(new Error("[Storage] SQLite worker client reset for tests"));
}
