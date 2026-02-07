import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { ENV } from "@/config/environment";
import { createLogger } from "@/infra/logging/structured-logger";
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

let sqliteWorker: Worker | null = null;
let sqliteWorkerStartError: Error | null = null;
let sqliteWorkerRequestId = 0;
let sqliteWorkerAllowedRoots: string[] = [process.cwd()];
const pendingRequests = new Map<number, PendingRequest>();

function normalizeRoots(roots: string[]): string[] {
  const normalized = roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  if (normalized.length === 0) {
    return [process.cwd()];
  }
  return [...new Set(normalized)];
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(fallback, { cause: error });
}

function resolveWorkerEntrypointPath(): string {
  const fromDistRuntime = Boolean(
    process.argv[1]?.includes(`${path.sep}dist${path.sep}`)
  );
  const candidates = fromDistRuntime
    ? [
        path.join(
          process.cwd(),
          "dist",
          "infra",
          "storage",
          "sqlite-worker.entry.mjs"
        ),
        path.join(
          process.cwd(),
          "dist",
          "infra",
          "storage",
          "sqlite-worker.entry.js"
        ),
        path.join(
          process.cwd(),
          "src",
          "infra",
          "storage",
          "sqlite-worker.entry.ts"
        ),
      ]
    : [
        path.join(
          process.cwd(),
          "src",
          "infra",
          "storage",
          "sqlite-worker.entry.ts"
        ),
        path.join(
          process.cwd(),
          "dist",
          "infra",
          "storage",
          "sqlite-worker.entry.mjs"
        ),
        path.join(
          process.cwd(),
          "dist",
          "infra",
          "storage",
          "sqlite-worker.entry.js"
        ),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `[Storage] SQLite worker entrypoint not found. Tried: ${candidates.join(", ")}`
  );
}

function rejectAllPending(error: Error): void {
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function ensureSqliteWorker(): Worker {
  if (!ENV.sqliteWorkerEnabled) {
    throw new Error("[Storage] SQLITE_WORKER_ENABLED is false");
  }
  if (sqliteWorker) {
    return sqliteWorker;
  }
  if (sqliteWorkerStartError) {
    throw sqliteWorkerStartError;
  }

  try {
    const entryPath = resolveWorkerEntrypointPath();
    const initData: SqliteWorkerInitData = {
      kind: SQLITE_WORKER_KIND,
      allowedRoots: [...sqliteWorkerAllowedRoots],
    };
    const worker = new Worker(entryPath, { workerData: initData });

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
      const exitError = new Error(
        `[Storage] SQLite worker exited with code ${code}`
      );
      sqliteWorkerStartError = exitError;
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
  const existingWorker = sqliteWorker;
  ensureSqliteWorker();
  if (existingWorker) {
    const refreshRoots = callSqliteWorker("storage", "setAllowedRoots", [
      sqliteWorkerAllowedRoots,
    ]);
    refreshRoots.catch((error) => {
      logger.warn("Failed to refresh SQLite worker allowed roots", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export async function configureSqliteWorkerAllowedRoots(
  allowedRoots: string[]
): Promise<void> {
  sqliteWorkerAllowedRoots = normalizeRoots(allowedRoots);
  if (!ENV.sqliteWorkerEnabled) {
    return;
  }
  await callSqliteWorker("storage", "setAllowedRoots", [
    sqliteWorkerAllowedRoots,
  ]);
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
      pendingRequests.delete(requestId);
      reject(
        new Error(
          `[Storage] SQLite worker request timed out: ${service}.${method} (${ENV.sqliteWorkerRequestTimeoutMs}ms)`
        )
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
