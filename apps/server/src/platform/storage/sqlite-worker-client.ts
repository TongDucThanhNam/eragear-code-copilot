import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import type { AppConfig } from "@/shared/types/settings.types";
import { toError } from "@/shared/utils/error.util";
import type {
  SqliteWorkerInitData,
  SqliteWorkerMessage,
  SqliteWorkerRequest,
  SqliteWorkerResponse,
  SqliteWorkerService,
} from "./sqlite-worker.protocol";
import { SQLITE_WORKER_KIND } from "./sqlite-worker.protocol";

const logger = createLogger("Storage");
const SQLITE_WORKER_READY_TIMEOUT_MS = 5000;

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
let sqliteWorkerAllowedRoots: string[] = [];
const pendingRequests = new Map<number, PendingRequest>();
let sqliteWorkerRecyclePromise: Promise<void> | null = null;
let sqliteWorkerStartupPromise: Promise<Worker> | null = null;
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
    .filter((root) => root.length > 0)
    .map((root) => path.resolve(root));
  if (normalized.length === 0) {
    throw new Error(
      "[Storage] SQLite worker allowed roots must contain at least one path."
    );
  }
  for (const root of normalized) {
    const parsed = path.parse(root);
    if (root === parsed.root) {
      throw new Error(
        `[Storage] SQLite worker allowed root "${root}" cannot be a filesystem root.`
      );
    }
  }
  return [...new Set(normalized)];
}

function resolveWorkerEntrypointPath(): string {
  const runtimeDir = path.dirname(process.execPath);
  const fromDistRuntime = runtimeDir.includes(`${path.sep}dist`);
  const srcFromCwd = [
    path.join(process.cwd(), "src", "bootstrap", "sqlite-worker.entry.ts"),
  ];
  const distFromCwd = [
    path.join(process.cwd(), "dist", "bootstrap", "sqlite-worker.entry.mjs"),
    path.join(process.cwd(), "dist", "bootstrap", "sqlite-worker.entry.js"),
  ];
  const distFromRuntime = [
    path.join(runtimeDir, "bootstrap", "sqlite-worker.entry.mjs"),
    path.join(runtimeDir, "bootstrap", "sqlite-worker.entry.js"),
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
  sqliteWorkerStartupPromise = null;
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

function resolveWorkerResponseError(message: SqliteWorkerResponse): Error {
  const errorData = message.error;
  const error = new Error(errorData?.message ?? "SQLite worker request failed");
  error.name = errorData?.name ?? "SqliteWorkerError";
  if (errorData?.stack) {
    error.stack = errorData.stack;
  }
  return error;
}

function handleWorkerResponseMessage(raw: unknown): void {
  const message = raw as SqliteWorkerMessage;
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
  pending.reject(resolveWorkerResponseError(message));
}

function attachRuntimeWorkerListeners(worker: Worker): void {
  worker.on("message", handleWorkerResponseMessage);
  worker.on("error", (error) => {
    logger.error("SQLite worker runtime error", toError(error));
  });

  worker.on("exit", (code) => {
    if (sqliteWorker === worker) {
      sqliteWorker = null;
    }
    sqliteWorkerStartupPromise = null;
    const exitError = new Error(
      `[Storage] SQLite worker exited with code ${code}`
    );
    rejectAllPending(exitError);
    if (code !== 0) {
      logger.error("SQLite worker exited unexpectedly", exitError);
    }
  });
}

async function startSqliteWorker(): Promise<Worker> {
  if (sqliteWorkerAllowedRoots.length === 0) {
    throw new Error(
      "[Storage] SQLite worker cannot start before allowed roots are configured."
    );
  }

  const entryPath = resolveWorkerEntrypointPath();
  const initData: SqliteWorkerInitData = {
    kind: SQLITE_WORKER_KIND,
    allowedRoots: [...sqliteWorkerAllowedRoots],
  };
  const worker = sqliteWorkerFactory(entryPath, initData);

  try {
    const readyWorker = await new Promise<Worker>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `[Storage] SQLite worker startup timed out after ${SQLITE_WORKER_READY_TIMEOUT_MS}ms`
          )
        );
      }, SQLITE_WORKER_READY_TIMEOUT_MS);
      timer.unref?.();

      const handleStartupError = (error: unknown) => {
        cleanup();
        reject(toError(error, "SQLite worker failed before ready"));
      };

      const handleStartupExit = (code: number) => {
        cleanup();
        reject(
          new Error(
            `[Storage] SQLite worker exited before ready with code ${code}`
          )
        );
      };

      const handleReady = (raw: unknown) => {
        const message = raw as SqliteWorkerMessage;
        if (message?.type !== "ready") {
          return;
        }
        cleanup();
        attachRuntimeWorkerListeners(worker);
        sqliteWorker = worker;
        sqliteWorkerStartError = null;
        logger.info("SQLite worker started", { entryPath });
        resolve(worker);
      };

      const cleanup = () => {
        clearTimeout(timer);
        worker.off("message", handleReady);
        worker.off("error", handleStartupError);
        worker.off("exit", handleStartupExit);
      };

      worker.on("message", handleReady);
      worker.on("error", handleStartupError);
      worker.on("exit", handleStartupExit);
    });
    return readyWorker;
  } catch (error) {
    const startError = toError(error, "Failed to start SQLite worker");
    sqliteWorkerStartError = startError;
    try {
      await worker.terminate();
    } catch {
      // Best effort termination on startup failure.
    }
    throw startError;
  }
}

function ensureSqliteWorker(): Promise<Worker> {
  if (!ENV.sqliteWorkerEnabled) {
    throw new Error("[Storage] STORAGE_WORKER_ENABLED is false");
  }
  if (sqliteWorker) {
    return Promise.resolve(sqliteWorker);
  }
  if (sqliteWorkerStartupPromise) {
    return sqliteWorkerStartupPromise;
  }
  if (sqliteWorkerStartError) {
    logger.warn("Retrying SQLite worker startup after previous failure", {
      error: sqliteWorkerStartError.message,
    });
    sqliteWorkerStartError = null;
  }
  sqliteWorkerStartupPromise = startSqliteWorker().finally(() => {
    sqliteWorkerStartupPromise = null;
  });
  return sqliteWorkerStartupPromise;
}

export function isSqliteWorkerEnabled(): boolean {
  return ENV.sqliteWorkerEnabled;
}

export async function initializeSqliteWorker(
  allowedRoots: string[]
): Promise<void> {
  if (!ENV.sqliteWorkerEnabled) {
    return;
  }
  sqliteWorkerAllowedRoots = normalizeRoots(allowedRoots);
  await ensureSqliteWorker();
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

export async function callSqliteWorker<T>(
  service: SqliteWorkerService,
  method: string,
  args: unknown[]
): Promise<T> {
  const worker = await ensureSqliteWorker();
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
  const startupPromise = sqliteWorkerStartupPromise;
  if (startupPromise) {
    try {
      await startupPromise;
    } catch {
      sqliteWorkerStartupPromise = null;
      sqliteWorkerStartError = null;
      rejectAllPending(new Error("[Storage] SQLite worker stopped"));
      return;
    }
  }

  const worker = sqliteWorker;
  if (!worker) {
    sqliteWorkerStartupPromise = null;
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
    sqliteWorkerStartupPromise = null;
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
  sqliteWorkerStartupPromise = null;
  sqliteWorkerStartError = null;
  sqliteWorkerRequestId = 0;
  sqliteWorkerAllowedRoots = [];
  sqliteWorkerRecyclePromise = null;
  sqliteWorkerFactory = defaultSqliteWorkerFactory;
  sqliteWorkerStats.recycleCount = 0;
  sqliteWorkerStats.timeoutCount = 0;
  sqliteWorkerStats.lastRecycleReason = null;
  sqliteWorkerStats.lastRecycleAt = null;
  rejectAllPending(new Error("[Storage] SQLite worker client reset for tests"));
}
