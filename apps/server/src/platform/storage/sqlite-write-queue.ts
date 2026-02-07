import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";

const logger = createLogger("Storage");

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = `${error.name} ${error.message}`.toUpperCase();
  return text.includes("SQLITE_BUSY") || text.includes("DATABASE IS LOCKED");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SqliteWriteQueueStats {
  pending: number;
  maxDepth: number;
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
}

class SqliteWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private maxDepth = 0;
  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailed = 0;

  enqueue<T>(operation: string, task: () => Promise<T> | T): Promise<T> {
    this.pending += 1;
    this.totalEnqueued += 1;
    this.maxDepth = Math.max(this.maxDepth, this.pending);

    const runTask = async () => {
      try {
        const result = await this.runWithBusyRetry(operation, task);
        this.totalCompleted += 1;
        return result;
      } catch (error) {
        this.totalFailed += 1;
        throw error;
      } finally {
        this.pending = Math.max(0, this.pending - 1);
      }
    };

    const taskPromise = this.tail.then(runTask, runTask);
    this.tail = taskPromise.then(
      () => undefined,
      () => undefined
    );
    return taskPromise;
  }

  private async runWithBusyRetry<T>(
    operation: string,
    task: () => Promise<T> | T
  ): Promise<T> {
    const maxAttempts = Math.max(1, ENV.sqliteBusyMaxRetries);
    const baseDelayMs = Math.max(1, ENV.sqliteBusyRetryBaseDelayMs);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const result = await task();
        const durationMs = Date.now() - startedAt;
        if (attempt > 1) {
          logger.warn("SQLite write succeeded after busy retries", {
            operation,
            attempt,
            maxAttempts,
            durationMs,
            queueDepth: this.pending,
          });
        }
        return result;
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt >= maxAttempts) {
          logger.error(
            "SQLite write failed",
            error instanceof Error ? error : new Error(String(error)),
            {
              operation,
              attempt,
              maxAttempts,
              queueDepth: this.pending,
            }
          );
          throw error;
        }

        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        logger.warn("SQLite busy encountered during write; retrying", {
          operation,
          attempt,
          maxAttempts,
          delayMs,
          queueDepth: this.pending,
        });
        await sleep(delayMs);
      }
    }

    throw new Error("Unreachable SQLite write retry state");
  }

  getStats(): SqliteWriteQueueStats {
    return {
      pending: this.pending,
      maxDepth: this.maxDepth,
      totalEnqueued: this.totalEnqueued,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
    };
  }
}

const sqliteWriteQueue = new SqliteWriteQueue();

export function enqueueSqliteWrite<T>(
  operation: string,
  task: () => Promise<T> | T
): Promise<T> {
  return sqliteWriteQueue.enqueue(operation, task);
}

export function getSqliteWriteQueueStats(): SqliteWriteQueueStats {
  return sqliteWriteQueue.getStats();
}
