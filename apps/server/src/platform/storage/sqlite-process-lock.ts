import { Database } from "bun:sqlite";
import path from "node:path";
import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { toError } from "@/shared/utils/error.util";

const logger = createLogger("Storage");
const SQLITE_INIT_LOCK_FILE_NAME = "eragear.sqlite.init.lock.db";

export interface SqliteProcessInitLock {
  lockPath: string;
  release(): void;
}

function closeLockDb(lockDb: Database): void {
  try {
    lockDb.close();
  } catch {
    // Ignore close failures during lock teardown.
  }
}

function beginExclusiveLock(lockDb: Database): void {
  const busyTimeoutMs = Math.max(1, Math.trunc(ENV.sqliteBusyTimeoutMs));
  lockDb.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  lockDb.exec("PRAGMA journal_mode = DELETE");
  lockDb.exec("PRAGMA synchronous = NORMAL");
  lockDb.exec("BEGIN EXCLUSIVE");
}

function rollbackExclusiveLock(lockDb: Database): void {
  lockDb.exec("ROLLBACK");
}

export function acquireSqliteProcessInitLock(
  storageDir: string
): SqliteProcessInitLock {
  const lockPath = path.join(storageDir, SQLITE_INIT_LOCK_FILE_NAME);
  const lockDb = new Database(lockPath);
  try {
    beginExclusiveLock(lockDb);
  } catch (error) {
    closeLockDb(lockDb);
    throw new Error(
      `[Storage] Failed to acquire SQLite initialization lock (${lockPath})`,
      { cause: toError(error, "SQLite init lock acquisition failed") }
    );
  }

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
        logger.warn("Failed to roll back SQLite initialization lock", {
          lockPath,
          error: toError(error, "SQLite init lock rollback failed").message,
        });
      } finally {
        closeLockDb(lockDb);
      }
    },
  };
}
