import { Database } from "bun:sqlite";
import path from "node:path";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { toError } from "@/shared/utils/error.util";
import { isSqliteBusyError } from "./sqlite-errors";

const logger = createLogger("Storage");
const SQLITE_INIT_LOCK_FILE_NAME = "eragear.sqlite.init.lock.db";
const SQLITE_LOCK_ATTEMPT_BUSY_TIMEOUT_MAX_MS = 25;

export interface SqliteProcessInitLock {
  lockPath: string;
  release(): void;
}

export class SqliteProcessInitLockTimeoutError extends Error {
  readonly lockPath: string;
  readonly attempts: number;
  readonly timeoutMs: number;

  constructor(params: {
    lockPath: string;
    attempts: number;
    timeoutMs: number;
    cause: Error;
  }) {
    super(
      `[Storage] Failed to acquire SQLite initialization lock after ${params.attempts} attempts in ${params.timeoutMs}ms (${params.lockPath})`,
      { cause: params.cause }
    );
    this.name = "SqliteProcessInitLockTimeoutError";
    this.lockPath = params.lockPath;
    this.attempts = params.attempts;
    this.timeoutMs = params.timeoutMs;
  }
}

function closeLockDb(lockDb: Database): void {
  try {
    lockDb.close();
  } catch {
    // Ignore close failures during lock teardown.
  }
}

function beginExclusiveLock(lockDb: Database, busyTimeoutMs: number): void {
  lockDb.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  lockDb.exec("PRAGMA journal_mode = DELETE");
  lockDb.exec("PRAGMA synchronous = NORMAL");
  lockDb.exec("BEGIN EXCLUSIVE");
}

function rollbackExclusiveLock(lockDb: Database): void {
  lockDb.exec("ROLLBACK");
}

function normalizeLockTimeoutMs(): number {
  return Math.max(1, Math.trunc(ENV.sqliteBusyTimeoutMs));
}

function resolveAttemptBusyTimeoutMs(lockTimeoutMs: number): number {
  return Math.max(
    1,
    Math.min(lockTimeoutMs, SQLITE_LOCK_ATTEMPT_BUSY_TIMEOUT_MAX_MS)
  );
}

function resolveRetryDelayMs(attemptBusyTimeoutMs: number): number {
  const configured = Math.max(1, Math.trunc(ENV.sqliteBusyRetryBaseDelayMs));
  return Math.min(configured, attemptBusyTimeoutMs);
}

async function waitForNextAttempt(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
  });
}

function createSqliteInitLock(
  lockPath: string,
  lockDb: Database
): SqliteProcessInitLock {
  let released = false;
  return {
    lockPath,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      try {
        rollbackExclusiveLock(lockDb);
      } catch (error) {
        logger.debug("Failed to roll back SQLite initialization lock", {
          lockPath,
          error: toError(error, "SQLite init lock rollback failed").message,
        });
      } finally {
        closeLockDb(lockDb);
      }
    },
  };
}

export async function acquireSqliteProcessInitLock(
  storageDir: string
): Promise<SqliteProcessInitLock> {
  const lockPath = path.join(storageDir, SQLITE_INIT_LOCK_FILE_NAME);
  const lockTimeoutMs = normalizeLockTimeoutMs();
  const attemptBusyTimeoutMs = resolveAttemptBusyTimeoutMs(lockTimeoutMs);
  const retryDelayMs = resolveRetryDelayMs(attemptBusyTimeoutMs);
  const startedAt = Date.now();
  let attempts = 0;

  while (true) {
    attempts += 1;
    const lockDb = new Database(lockPath);
    try {
      beginExclusiveLock(lockDb, attemptBusyTimeoutMs);
      return createSqliteInitLock(lockPath, lockDb);
    } catch (error) {
      closeLockDb(lockDb);
      if (!isSqliteBusyError(error)) {
        throw new Error(
          `[Storage] Failed to acquire SQLite initialization lock (${lockPath})`,
          { cause: toError(error, "SQLite init lock acquisition failed") }
        );
      }

      const elapsedMs = Date.now() - startedAt;
      const remainingMs = lockTimeoutMs - elapsedMs;
      if (remainingMs <= 0) {
        throw new SqliteProcessInitLockTimeoutError({
          lockPath,
          attempts,
          timeoutMs: lockTimeoutMs,
          cause: toError(error, "SQLite init lock acquisition timed out"),
        });
      }
      await waitForNextAttempt(Math.min(retryDelayMs, remainingMs));
    }
  }
}
