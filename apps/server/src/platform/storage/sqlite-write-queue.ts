import { ENV } from "@/config/environment";
import { createLogger } from "@/platform/logging/structured-logger";
import { systemClock } from "@/platform/time/system-clock";
import { isAppError } from "@/shared/errors";
import type { ClockPort } from "@/shared/ports/clock.port";
import { isSqliteBusyError } from "./sqlite-errors";

const logger = createLogger("Storage");

type SqliteWritePriority = "high" | "low";

interface SqliteWriteQueuePolicy {
  busyMaxRetries: number;
  busyRetryBaseDelayMs: number;
  maxPending: number;
}

function readPolicyFromEnv(): SqliteWriteQueuePolicy {
  return {
    busyMaxRetries: Math.max(1, Math.trunc(ENV.sqliteBusyMaxRetries)),
    busyRetryBaseDelayMs: Math.max(
      1,
      Math.trunc(ENV.sqliteBusyRetryBaseDelayMs)
    ),
    maxPending: Math.max(1, Math.trunc(ENV.sqliteWriteQueueMaxPending)),
  };
}

let sqliteWriteQueuePolicyOverride: SqliteWriteQueuePolicy | null = null;

function resolveQueuePolicy(): SqliteWriteQueuePolicy {
  return sqliteWriteQueuePolicyOverride ?? readPolicyFromEnv();
}

export interface SqliteWriteQueueStats {
  pending: number;
  writeQueueDepth: number;
  pendingTotal: number;
  pendingHigh: number;
  pendingLow: number;
  rejectedOverload: number;
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

interface QueuedWriteTask<T> {
  operation: string;
  task: () => Promise<T> | T;
  policy: SqliteWriteQueuePolicy;
  priority: SqliteWritePriority;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class SqliteWriteQueueOverloadedError extends Error {
  readonly pending: number;
  readonly maxPending: number;

  constructor(params: { pending: number; maxPending: number }) {
    super(
      `[Storage] SQLite write queue overloaded (${params.pending} pending, max ${params.maxPending})`
    );
    this.name = "SqliteWriteQueueOverloadedError";
    this.pending = params.pending;
    this.maxPending = params.maxPending;
  }
}

class SqliteWriteQueue {
  private readonly clock: ClockPort;

  private pendingHigh = 0;
  private pendingLow = 0;
  private rejectedOverload = 0;
  private busyRetryCount = 0;
  private maxHeadWaitMs = 0;
  private maxDepth = 0;
  private totalEnqueued = 0;
  private totalCompleted = 0;
  private totalFailed = 0;
  private readonly pendingPromises = new Set<Promise<unknown>>();
  private readonly highPriorityQueue: QueuedWriteTask<unknown>[] = [];
  private readonly lowPriorityQueue: QueuedWriteTask<unknown>[] = [];
  private processingLoop: Promise<void> | null = null;

  constructor(clock: ClockPort = systemClock) {
    this.clock = clock;
  }

  enqueue<T>(
    operation: string,
    task: () => Promise<T> | T,
    options?: EnqueueSqliteWriteOptions
  ): Promise<T> {
    const priority = options?.priority ?? "high";
    const policy = resolveQueuePolicy();
    const pendingNow = this.pendingTotal();
    if (pendingNow >= policy.maxPending) {
      this.rejectedOverload += 1;
      const overloadError = new SqliteWriteQueueOverloadedError({
        pending: pendingNow,
        maxPending: policy.maxPending,
      });
      logger.info("Rejected SQLite write enqueue due to queue overload", {
        operation,
        pending: pendingNow,
        maxPending: policy.maxPending,
      });
      return Promise.reject(overloadError);
    }

    this.incrementPending(priority);

    let resolveTask: (value: T) => void = () => undefined;
    let rejectTask: (error: unknown) => void = () => undefined;

    const operationPromise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    }).finally(() => {
      this.pendingPromises.delete(operationPromise);
      this.decrementPending(priority);
    });

    this.pendingPromises.add(operationPromise);
    this.enqueueTask({
      operation,
      task,
      policy,
      priority,
      resolve: (value) => resolveTask(value as T),
      reject: rejectTask,
    });
    this.startProcessingLoop();
    return operationPromise;
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

  private enqueueTask(task: QueuedWriteTask<unknown>): void {
    if (task.priority === "high") {
      this.highPriorityQueue.push(task);
      return;
    }
    this.lowPriorityQueue.push(task);
  }

  private dequeueTask(): QueuedWriteTask<unknown> | undefined {
    if (this.highPriorityQueue.length > 0) {
      return this.highPriorityQueue.shift();
    }
    if (this.lowPriorityQueue.length > 0) {
      return this.lowPriorityQueue.shift();
    }
    return undefined;
  }

  private startProcessingLoop(): void {
    if (this.processingLoop) {
      return;
    }
    this.processingLoop = this.processQueuedTasks().finally(() => {
      this.processingLoop = null;
      if (this.pendingTotal() > 0) {
        this.startProcessingLoop();
      }
    });
  }

  private async processQueuedTasks(): Promise<void> {
    while (true) {
      const queuedTask = this.dequeueTask();
      if (!queuedTask) {
        return;
      }
      await this.runQueuedTask(queuedTask);
    }
  }

  private async runQueuedTask(task: QueuedWriteTask<unknown>): Promise<void> {
    try {
      const result = await this.runWithBusyRetry(
        task.operation,
        task.task,
        task.policy
      );
      this.totalCompleted += 1;
      task.resolve(result);
    } catch (error) {
      this.totalFailed += 1;
      task.reject(error);
    }
  }

  private async runWithBusyRetry<T>(
    operation: string,
    task: () => Promise<T> | T,
    policy: SqliteWriteQueuePolicy
  ): Promise<T> {
    let attempt = 1;

    while (true) {
      const startedAt = this.clock.nowMs();
      try {
        return await task();
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt >= policy.busyMaxRetries) {
          const normalizedError =
            error instanceof Error ? error : new Error(String(error));
          const context = {
            operation,
            attempt,
            maxAttempts: policy.busyMaxRetries,
            pendingTotal: this.pendingTotal(),
          };
          if (isAppError(error) && error.statusCode < 500) {
            logger.info("SQLite write rejected by application invariant", {
              ...context,
              code: error.code,
              statusCode: error.statusCode,
              message: error.message,
            });
          } else {
            logger.error("SQLite write failed", normalizedError, context);
          }
          throw error;
        }

        const delayMs = policy.busyRetryBaseDelayMs * 2 ** (attempt - 1);
        this.busyRetryCount += 1;
        this.maxHeadWaitMs = Math.max(this.maxHeadWaitMs, delayMs);
        logger.debug("SQLite busy encountered during write; retrying", {
          operation,
          attempt,
          maxAttempts: policy.busyMaxRetries,
          delayMs,
          durationMs: this.clock.nowMs() - startedAt,
          pendingTotal: this.pendingTotal(),
        });

        attempt += 1;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          timer.unref?.();
        });
      }
    }
  }

  getStats(): SqliteWriteQueueStats {
    const pending = this.pendingTotal();
    return {
      pending,
      writeQueueDepth: pending,
      pendingTotal: pending,
      pendingHigh: this.pendingHigh,
      pendingLow: this.pendingLow,
      rejectedOverload: this.rejectedOverload,
      busyRetryCount: this.busyRetryCount,
      headBlockedMs: 0,
      maxHeadWaitMs: this.maxHeadWaitMs,
      maxDepth: this.maxDepth,
      totalEnqueued: this.totalEnqueued,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
    };
  }

  async flush(timeoutMs = 30_000): Promise<boolean> {
    const normalizedTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
    const startedAt = this.clock.nowMs();

    while (true) {
      if (this.pendingPromises.size === 0 && this.pendingTotal() === 0) {
        return true;
      }
      if (this.clock.nowMs() - startedAt >= normalizedTimeoutMs) {
        return false;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5);
        timer.unref?.();
      });
    }
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

export async function flushSqliteWriteQueue(
  timeoutMs?: number
): Promise<boolean> {
  return await sqliteWriteQueue.flush(timeoutMs);
}

export function setSqliteWriteQueuePolicyForTests(
  policy: Partial<SqliteWriteQueuePolicy> | null
): void {
  if (!policy) {
    sqliteWriteQueuePolicyOverride = null;
    return;
  }
  const base = readPolicyFromEnv();
  sqliteWriteQueuePolicyOverride = {
    busyMaxRetries:
      policy.busyMaxRetries === undefined
        ? base.busyMaxRetries
        : Math.max(1, Math.trunc(policy.busyMaxRetries)),
    busyRetryBaseDelayMs:
      policy.busyRetryBaseDelayMs === undefined
        ? base.busyRetryBaseDelayMs
        : Math.max(1, Math.trunc(policy.busyRetryBaseDelayMs)),
    maxPending:
      policy.maxPending === undefined
        ? base.maxPending
        : Math.max(1, Math.trunc(policy.maxPending)),
  };
}
