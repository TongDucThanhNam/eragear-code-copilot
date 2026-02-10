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
  private readonly highQueue: EnqueuedWriteTask[] = [];
  private readonly lowQueue: EnqueuedWriteTask[] = [];
  private readonly clock: ClockPort;

  private drainScheduled = false;
  private delayedDrainTimer: ReturnType<typeof setTimeout> | null = null;
  private delayedDrainAtMs: number | null = null;
  private running = false;

  private pendingHigh = 0;
  private pendingLow = 0;
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
    return this.highQueue.length > 0 || this.lowQueue.length > 0;
  }

  private pushTask(task: EnqueuedWriteTask): void {
    if (task.priority === "high") {
      this.highQueue.push(task);
      return;
    }
    this.lowQueue.push(task);
  }

  private dequeueReadyTask(nowMs: number): EnqueuedWriteTask | undefined {
    const highIndex = this.findReadyTaskIndex(this.highQueue, nowMs);
    if (highIndex >= 0) {
      return this.highQueue.splice(highIndex, 1)[0];
    }

    const lowIndex = this.findReadyTaskIndex(this.lowQueue, nowMs);
    if (lowIndex >= 0) {
      return this.lowQueue.splice(lowIndex, 1)[0];
    }

    return undefined;
  }

  private findReadyTaskIndex(
    queue: EnqueuedWriteTask[],
    nowMs: number
  ): number {
    for (let i = 0; i < queue.length; i += 1) {
      const task = queue[i];
      if (task && task.notBeforeMs <= nowMs) {
        return i;
      }
    }
    return -1;
  }

  private nextDelayedReadyAtMs(): number | null {
    let earliest: number | null = null;
    for (const task of this.highQueue) {
      if (earliest === null || task.notBeforeMs < earliest) {
        earliest = task.notBeforeMs;
      }
    }
    for (const task of this.lowQueue) {
      if (earliest === null || task.notBeforeMs < earliest) {
        earliest = task.notBeforeMs;
      }
    }
    return earliest;
  }

  private hasReadyTask(nowMs: number): boolean {
    return (
      this.findReadyTaskIndex(this.highQueue, nowMs) >= 0 ||
      this.findReadyTaskIndex(this.lowQueue, nowMs) >= 0
    );
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
        const nowMs = this.clock.nowMs();
        const nextTask = this.dequeueReadyTask(nowMs);
        if (!nextTask) {
          const nextReadyAtMs = this.nextDelayedReadyAtMs();
          if (nextReadyAtMs !== null) {
            this.scheduleDelayedDrain(nextReadyAtMs);
          }
          break;
        }

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
          this.handleTaskFailure(nextTask, error);
        }
      }
    } finally {
      this.running = false;
      if (this.hasPendingQueue()) {
        const nowMs = this.clock.nowMs();
        if (this.hasReadyTask(nowMs)) {
          this.scheduleImmediateDrain();
        } else {
          const nextReadyAtMs = this.nextDelayedReadyAtMs();
          if (nextReadyAtMs !== null) {
            this.scheduleDelayedDrain(nextReadyAtMs);
          }
        }
      }
    }
  }

  private handleTaskFailure(task: EnqueuedWriteTask, error: unknown): boolean {
    if (isSqliteBusyError(error) && task.attempt < task.maxAttempts) {
      const delayMs = task.retryBaseDelayMs * 2 ** (task.attempt - 1);
      logger.warn("SQLite busy encountered during write; retrying", {
        operation: task.operation,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        delayMs,
        queueDepth: this.pendingTotal(),
      });
      task.attempt += 1;
      task.notBeforeMs = this.clock.nowMs() + delayMs;
      this.pushTask(task);
      return true;
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
    return false;
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
