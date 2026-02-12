import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { systemClock } from "@/platform/time/system-clock";
import type { ClockPort } from "@/shared/ports/clock.port";

const logger = createLogger("Storage");

type SqliteWritePriority = "high" | "low";

interface SqliteWriteQueuePolicy {
  busyMaxRetries: number;
  busyRetryBaseDelayMs: number;
}

function readPolicyFromEnv(): SqliteWriteQueuePolicy {
  return {
    busyMaxRetries: Math.max(1, Math.trunc(ENV.sqliteBusyMaxRetries)),
    busyRetryBaseDelayMs: Math.max(
      1,
      Math.trunc(ENV.sqliteBusyRetryBaseDelayMs)
    ),
  };
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = `${error.name} ${error.message}`.toUpperCase();
  return text.includes("SQLITE_BUSY") || text.includes("DATABASE IS LOCKED");
}

export interface SqliteWriteQueueStats {
  pending: number;
  writeQueueDepth: number;
  pendingTotal: number;
  pendingHigh: number;
  pendingLow: number;
  busyRetryCount: number;
  headBlockedMs: number;
  maxHeadWaitMs: number;
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
  attempt: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  notBeforeMs: number;
}

class SqliteWriteQueue {
  private readonly queue: EnqueuedWriteTask[] = [];
  private readonly clock: ClockPort;

  private drainScheduled = false;
  private delayedDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private delayedDrainAtMs: number | null = null;
  private running = false;

  private pendingHigh = 0;
  private pendingLow = 0;
  private busyRetryCount = 0;
  private maxHeadWaitMs = 0;
  private maxDepth = 0;
  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailed = 0;

  constructor(clock: ClockPort = systemClock) {
    this.clock = clock;
  }

  enqueue<T>(
    operation: string,
    task: () => Promise<T> | T,
    options?: EnqueueSqliteWriteOptions
  ): Promise<T> {
    const priority = options?.priority ?? "high";
    this.incrementPending(priority);
    const policy = readPolicyFromEnv();

    return new Promise<T>((resolve, reject) => {
      const queuedTask: EnqueuedWriteTask = {
        operation,
        priority,
        run: async () => await task(),
        resolve: (value) => resolve(value as T),
        reject: (error) => reject(error),
        attempt: 1,
        maxAttempts: policy.busyMaxRetries,
        retryBaseDelayMs: policy.busyRetryBaseDelayMs,
        notBeforeMs: this.clock.nowMs(),
      };
      this.pushTask(queuedTask);
      this.scheduleImmediateDrain();
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
    return this.queue.length > 0;
  }

  private pushTask(task: EnqueuedWriteTask): void {
    this.queue.push(task);
  }

  private prependTask(task: EnqueuedWriteTask): void {
    this.queue.unshift(task);
  }

  private peekHeadTask(): EnqueuedWriteTask | undefined {
    return this.queue[0];
  }

  private dequeueHeadTask(): EnqueuedWriteTask | undefined {
    return this.queue.shift();
  }

  private scheduleImmediateDrain(): void {
    if (this.delayedDrainTimer) {
      clearTimeout(this.delayedDrainTimer);
      this.delayedDrainTimer = null;
      this.delayedDrainAtMs = null;
    }
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

  private scheduleDelayedDrain(runAtMs: number): void {
    const nowMs = this.clock.nowMs();
    const delayMs = Math.max(1, Math.trunc(runAtMs - nowMs));
    if (
      this.delayedDrainAtMs !== null &&
      this.delayedDrainAtMs <= runAtMs &&
      this.delayedDrainTimer
    ) {
      return;
    }
    if (this.delayedDrainTimer) {
      clearTimeout(this.delayedDrainTimer);
    }
    this.delayedDrainAtMs = runAtMs;
    this.delayedDrainTimer = setTimeout(() => {
      this.delayedDrainTimer = null;
      this.delayedDrainAtMs = null;
      this.scheduleImmediateDrain();
    }, delayMs);
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      while (true) {
        const nextTask = this.peekHeadTask();
        if (!nextTask) {
          break;
        }
        const nowMs = this.clock.nowMs();
        if (nextTask.notBeforeMs > nowMs) {
          const headBlockedMs = Math.max(
            0,
            Math.trunc(nextTask.notBeforeMs - nowMs)
          );
          this.maxHeadWaitMs = Math.max(this.maxHeadWaitMs, headBlockedMs);
          this.scheduleDelayedDrain(nextTask.notBeforeMs);
          break;
        }

        this.dequeueHeadTask();

        const startedAt = this.clock.nowMs();
        try {
          const result = await nextTask.run();
          const durationMs = this.clock.nowMs() - startedAt;
          if (nextTask.attempt > 1) {
            logger.warn("SQLite write succeeded after busy retries", {
              operation: nextTask.operation,
              attempt: nextTask.attempt,
              maxAttempts: nextTask.maxAttempts,
              durationMs,
              queueDepth: this.pendingTotal(),
            });
          }
          this.totalCompleted += 1;
          this.decrementPending(nextTask.priority);
          nextTask.resolve(result);
        } catch (error) {
          const outcome = this.handleTaskFailure(nextTask, error);
          if (outcome === "retry_delayed") {
            const blockedTask = this.peekHeadTask();
            if (blockedTask) {
              this.scheduleDelayedDrain(blockedTask.notBeforeMs);
            }
            break;
          }
        }
      }
    } finally {
      this.running = false;
      if (this.hasPendingQueue()) {
        const headTask = this.peekHeadTask();
        const nowMs = this.clock.nowMs();
        if (headTask && headTask.notBeforeMs <= nowMs) {
          this.scheduleImmediateDrain();
        } else if (headTask) {
          this.scheduleDelayedDrain(headTask.notBeforeMs);
        }
      }
    }
  }

  private handleTaskFailure(
    task: EnqueuedWriteTask,
    error: unknown
  ): "retry_delayed" | "failed" {
    if (isSqliteBusyError(error) && task.attempt < task.maxAttempts) {
      const delayMs = task.retryBaseDelayMs * 2 ** (task.attempt - 1);
      logger.warn("SQLite busy encountered during write; retrying", {
        operation: task.operation,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        delayMs,
        queueDepth: this.pendingTotal(),
      });
      this.busyRetryCount += 1;
      task.attempt += 1;
      task.notBeforeMs = this.clock.nowMs() + delayMs;
      this.prependTask(task);
      return "retry_delayed";
    }

    logger.error(
      "SQLite write failed",
      error instanceof Error ? error : new Error(String(error)),
      {
        operation: task.operation,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        queueDepth: this.pendingTotal(),
      }
    );
    this.totalFailed += 1;
    this.decrementPending(task.priority);
    task.reject(error);
    return "failed";
  }

  getStats(): SqliteWriteQueueStats {
    const pending = this.pendingTotal();
    const headTask = this.peekHeadTask();
    const nowMs = this.clock.nowMs();
    const headBlockedMs =
      headTask && headTask.notBeforeMs > nowMs
        ? Math.max(0, Math.trunc(headTask.notBeforeMs - nowMs))
        : 0;
    return {
      pending,
      writeQueueDepth: pending,
      pendingTotal: pending,
      pendingHigh: this.pendingHigh,
      pendingLow: this.pendingLow,
      busyRetryCount: this.busyRetryCount,
      headBlockedMs,
      maxHeadWaitMs: this.maxHeadWaitMs,
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
