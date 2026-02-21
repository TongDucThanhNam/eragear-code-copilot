import type { SessionServiceFactory } from "@/modules/service-factories";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { ChatSession } from "@/shared/types/session.types";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";
import { withTimeout } from "@/shared/utils/timeout.util";
import { createLogger } from "../platform/logging/structured-logger";
import { closeSqliteStorage } from "../platform/storage/sqlite-db";
import { runSqliteRuntimeMaintenance } from "../platform/storage/sqlite-store";

const logger = createLogger("Server");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHUTDOWN_COMPACTION_MAX_BUDGET_MS = 5000;
const SHUTDOWN_COMPACTION_MAX_BATCHES = 64;
const SHUTDOWN_SESSION_STOP_CONCURRENCY = 8;

export interface ServerShutdownPolicy {
  sqliteRetentionHotDays: number;
  backgroundTaskTimeoutMs: number;
  sqliteRetentionCompactionBatchSize: number;
}

export interface ServerShutdownDependencies {
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
  sessionServices: SessionServiceFactory;
  policy: ServerShutdownPolicy;
}

interface ShutdownPolicy {
  sqliteRetentionHotDays: number;
  backgroundTaskTimeoutMs: number;
  sqliteRetentionCompactionBatchSize: number;
}

interface SessionStopSummary {
  total: number;
  failures: number;
}

interface SessionStopResult {
  failed: boolean;
}

interface CompactionSummary {
  compactedTotal: number;
  batches: number;
  budgetMs: number;
  failed: boolean;
}

function normalizePolicy(policy: ServerShutdownPolicy): ShutdownPolicy {
  return {
    sqliteRetentionHotDays: Math.max(
      1,
      Math.trunc(policy.sqliteRetentionHotDays)
    ),
    backgroundTaskTimeoutMs: Math.max(
      1,
      Math.trunc(policy.backgroundTaskTimeoutMs)
    ),
    sqliteRetentionCompactionBatchSize: Math.max(
      1,
      Math.trunc(policy.sqliteRetentionCompactionBatchSize)
    ),
  };
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  maxConcurrent: number,
  worker: (item: T) => Promise<SessionStopResult>
): Promise<SessionStopResult[]> {
  if (items.length === 0) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.min(maxConcurrent, items.length));
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const results: SessionStopResult[] = new Array(items.length);

  for (let workerIndex = 0; workerIndex < normalizedLimit; workerIndex += 1) {
    workers.push(
      (async () => {
        while (cursor < items.length) {
          const itemIndex = cursor;
          cursor += 1;
          results[itemIndex] = await worker(items[itemIndex] as T);
        }
      })()
    );
  }

  await Promise.all(workers);
  return results;
}

async function stopRuntimeSession(
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort,
  session: ChatSession
): Promise<void> {
  try {
    await terminateSessionTerminals(session);
  } catch (error) {
    logger.warn("Failed to terminate session terminals during shutdown", {
      chatId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const termination = await terminateProcessGracefully(session.proc, {
    forceWindowsTreeTermination: true,
  });
  if (!termination.exited) {
    logger.warn("Session process did not exit after forced termination", {
      chatId: session.id,
      pid: session.proc.pid,
      signalSent: termination.signalSent,
    });
  }

  sessionRuntime.deleteIfMatch(session.id, session);
  await sessionRepo.updateStatus(session.id, session.userId, "stopped");
}

async function stopAllRuntimeSessions(
  sessionRuntime: SessionRuntimePort,
  sessionRepo: SessionRepositoryPort
): Promise<SessionStopSummary> {
  const sessions = sessionRuntime.getAll();
  const results = await runWithConcurrencyLimit(
    sessions,
    SHUTDOWN_SESSION_STOP_CONCURRENCY,
    async (session) => {
      try {
        await stopRuntimeSession(sessionRuntime, sessionRepo, session);
        return { failed: false };
      } catch (error) {
        logger.warn("Failed to stop runtime session during shutdown", {
          chatId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { failed: true };
      }
    }
  );

  return {
    total: sessions.length,
    failures: results.reduce(
      (count, result) => count + (result.failed ? 1 : 0),
      0
    ),
  };
}

async function compactMessagesWithinBudget(
  sessionServices: SessionServiceFactory,
  policy: ShutdownPolicy
): Promise<CompactionSummary> {
  const compactSessionMessagesService =
    sessionServices.compactSessionMessages();
  const compactBeforeTs =
    Date.now() - policy.sqliteRetentionHotDays * MS_PER_DAY;
  const budgetMs = Math.min(
    SHUTDOWN_COMPACTION_MAX_BUDGET_MS,
    policy.backgroundTaskTimeoutMs
  );
  const deadline = Date.now() + budgetMs;
  let compactedTotal = 0;
  let batches = 0;
  let failed = false;

  while (Date.now() < deadline && batches < SHUTDOWN_COMPACTION_MAX_BATCHES) {
    const remainingMs = Math.max(1, deadline - Date.now());
    batches += 1;

    try {
      const result = await withTimeout(
        compactSessionMessagesService.execute({
          beforeTimestamp: compactBeforeTs,
          batchSize: policy.sqliteRetentionCompactionBatchSize,
        }),
        remainingMs,
        "Shutdown message compaction timed out"
      );
      compactedTotal += result.compacted;
      if (result.compacted === 0) {
        break;
      }
    } catch (error) {
      failed = true;
      logger.warn("Shutdown message compaction failed", {
        error: error instanceof Error ? error.message : String(error),
        batches,
      });
      break;
    }
  }

  return {
    compactedTotal,
    batches,
    budgetMs,
    failed,
  };
}

async function runFinalStorageMaintenance(): Promise<void> {
  try {
    await runSqliteRuntimeMaintenance();
  } catch (error) {
    logger.warn("SQLite runtime maintenance failed during shutdown", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function closeStorageSafe(): Promise<void> {
  try {
    await closeSqliteStorage();
  } catch (error) {
    logger.warn("Failed to close SQLite storage during shutdown", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function executeServerShutdown(
  deps: ServerShutdownDependencies
): Promise<void> {
  const policy = normalizePolicy(deps.policy);
  const stopSummary = await stopAllRuntimeSessions(
    deps.sessionRuntime,
    deps.sessionRepo
  );
  const compactionSummary = await compactMessagesWithinBudget(
    deps.sessionServices,
    policy
  );

  if (stopSummary.total > 0 || compactionSummary.compactedTotal > 0) {
    logger.info("Shutdown cleanup summary", {
      stoppedSessions: stopSummary.total,
      stopFailures: stopSummary.failures,
      compactedTotal: compactionSummary.compactedTotal,
      compactionBatches: compactionSummary.batches,
      compactionBudgetMs: compactionSummary.budgetMs,
      compactionFailed: compactionSummary.failed,
    });
  }

  await runFinalStorageMaintenance();
  await closeStorageSafe();
}
