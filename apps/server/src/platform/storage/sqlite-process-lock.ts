import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@/platform/logging/structured-logger";

const logger = createLogger("Storage");
const SQLITE_INIT_LOCK_FILE_NAME = "eragear.sqlite.init.lock";
const LOCK_FILE_MODE = 0o600;
const MAX_RECLAIM_ATTEMPTS = 2;

interface ProcessLockPayload {
  pid: number;
  acquiredAt: number;
}

export interface SqliteProcessInitLock {
  lockPath: string;
  release(): Promise<void>;
}

function isErrnoCode(
  error: unknown,
  code: NodeJS.ErrnoException["code"]
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function parseLockPayload(raw: string): ProcessLockPayload | null {
  try {
    const parsed = JSON.parse(raw) as ProcessLockPayload;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.acquiredAt !== "number" ||
      !Number.isFinite(parsed.acquiredAt)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrnoCode(error, "ESRCH")) {
      return false;
    }
    return true;
  }
}

async function readLockPayload(
  lockPath: string
): Promise<ProcessLockPayload | null> {
  try {
    const content = await readFile(lockPath, "utf8");
    return parseLockPayload(content);
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function unlinkIfExists(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) {
      throw error;
    }
  }
}

export async function acquireSqliteProcessInitLock(
  storageDir: string
): Promise<SqliteProcessInitLock> {
  const lockPath = path.join(storageDir, SQLITE_INIT_LOCK_FILE_NAME);
  const payload: ProcessLockPayload = {
    pid: process.pid,
    acquiredAt: Date.now(),
  };

  for (let attempt = 1; attempt <= MAX_RECLAIM_ATTEMPTS; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, "wx", LOCK_FILE_MODE);
    } catch (error) {
      if (!isErrnoCode(error, "EEXIST")) {
        throw error;
      }

      const existing = await readLockPayload(lockPath);
      if (existing && existing.pid === process.pid) {
        throw new Error(
          `[Storage] SQLite initialization lock is already held by this process (${lockPath})`
        );
      }
      if (existing && isProcessAlive(existing.pid)) {
        throw new Error(
          `[Storage] SQLite initialization lock is held by pid ${existing.pid} (${lockPath})`
        );
      }

      logger.warn("Reclaiming stale SQLite initialization lock", {
        lockPath,
        ownerPid: existing?.pid ?? null,
      });
      await unlinkIfExists(lockPath);
      continue;
    }

    try {
      await handle.writeFile(JSON.stringify(payload));
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlinkIfExists(lockPath).catch(() => undefined);
      throw error;
    }

    let released = false;
    return {
      lockPath,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        await handle.close().catch(() => undefined);
        await unlinkIfExists(lockPath);
      },
    };
  }

  throw new Error(
    `[Storage] Failed to acquire SQLite initialization lock after ${MAX_RECLAIM_ATTEMPTS} attempts (${lockPath})`
  );
}
