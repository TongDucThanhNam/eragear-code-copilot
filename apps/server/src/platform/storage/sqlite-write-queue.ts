import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";

const logger = createLogger("Storage");

type SqliteWritePriority = "high" | "low";

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
  writeQueueDepth: number;
  pendingTotal: number;
  pendingHigh: number;
  pendingLow: number;
  maxDepth: number;
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
}

export interface EnqueueSqliteWriteOptions {
  priority?: SqliteWritePriority;
}

interface EnqueuedWriteTask {
  operation: string;
  priority: SqliteWritePriority;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

class SqliteWriteQueue {
  private readonly highQueue: EnqueuedWriteTask[] = [];
  private readonly lowQueue: EnqueuedWriteTask[] = [];
  private drainScheduled = false;
  private running = false;

  private pendingHigh = 0;
  private pendingLow = 0;
  private maxDepth = 0;
  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailed = 0;

  enqueue<T>(
    operation: string,
    task: () => Promise<T> | T,
    options?: EnqueueSqliteWriteOptions
  ): Promise<T> {
    const priority = options?.priority ?? "high";
    this.incrementPending(priority);

    return new Promise<T>((resolve, reject) => {
      const queuedTask: EnqueuedWriteTask = {
        operation,
        priority,
        run: async () => await task(),
        resolve: (value) => resolve(value as T),
        reject: (error) => reject(error),
      };
      if (priority === "high") {
        this.highQueue.push(queuedTask);
      } else {
        this.lowQueue.push(queuedTask);
      }
      this.scheduleDrain();
    });
  }

  private incrementPending(priority: SqliteWritePriority): void {
    if (priority === "high") {
      this.pendingHigh += 1;
    } else {
      this.pendingLow += 1;
    }
    this.totalEnqueued += 1;
    this.maxDepth = Math.max(this.maxDepth, this.pendingTotal());
  }

  private decrementPending(priority: SqliteWritePriority): void {
    if (priority === "high") {
      this.pendingHigh = Math.max(0, this.pendingHigh - 1);
      return;
    }
    this.pendingLow = Math.max(0, this.pendingLow - 1);
  }

  private pendingTotal(): number {
    return this.pendingHigh + this.pendingLow;
  }

  private hasPendingQueue(): boolean {
    return this.highQueue.length > 0 || this.lowQueue.length > 0;
  }

  private dequeueNext(): EnqueuedWriteTask | undefined {
    const high = this.highQueue.shift();
    if (high) {
      return high;
    }
    return this.lowQueue.shift();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain().catch((error) => {
        logger.error(
          "SQLite write queue drain failed",
          error instanceof Error ? error : new Error(String(error))
        );
      });
    });
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (true) {
        const nextTask = this.dequeueNext();
        if (!nextTask) {
          break;
        }

        try {
          const result = await this.runWithBusyRetry(
            nextTask.operation,
            nextTask.run
          );
          this.totalCompleted += 1;
          nextTask.resolve(result);
        } catch (error) {
          this.totalFailed += 1;
          nextTask.reject(error);
        } finally {
          this.decrementPending(nextTask.priority);
        }
      }
    } finally {
      this.running = false;
      if (this.hasPendingQueue()) {
        this.scheduleDrain();
      }
    }
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
            queueDepth: this.pendingTotal(),
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
              queueDepth: this.pendingTotal(),
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
          queueDepth: this.pendingTotal(),
        });
        await sleep(delayMs);
      }
    }

    throw new Error("Unreachable SQLite write retry state");
  }

  getStats(): SqliteWriteQueueStats {
    const pending = this.pendingTotal();
    return {
      pending,
      writeQueueDepth: pending,
      pendingTotal: pending,
      pendingHigh: this.pendingHigh,
      pendingLow: this.pendingLow,
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
  task: () => Promise<T> | T,
  options?: EnqueueSqliteWriteOptions
): Promise<T> {
  return sqliteWriteQueue.enqueue(operation, task, options);
}

export function getSqliteWriteQueueStats(): SqliteWriteQueueStats {
  return sqliteWriteQueue.getStats();
}
