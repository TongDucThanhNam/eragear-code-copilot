/**
 * SQLite Storage Maintenance Task
 *
 * Performs periodic DB checkpoint/vacuum work and compacts cold message payloads.
 *
 * @module infra/background/tasks/sqlite-storage-maintenance.task
 */

import { ENV } from "@/config/environment";
import type {
  CompactSessionMessagesService,
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import { createLogger } from "@/platform/logging/structured-logger";
import { runSqliteRuntimeMaintenance } from "@/platform/storage/sqlite-store";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";

const logger = createLogger("Storage");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createSqliteStorageMaintenanceTask(params: {
  sessionRepo: SessionRepositoryPort;
  sessionRuntime: SessionRuntimePort;
  compactSessionMessages: Pick<CompactSessionMessagesService, "execute">;
}): BackgroundTaskSpec {
  const { sessionRepo, sessionRuntime, compactSessionMessages } = params;

  return {
    name: "sqlite-storage-maintenance",
    intervalMs: ENV.backgroundSqliteMaintenanceIntervalMs,
    run: async () => {
      const hasActiveStreaming = sessionRuntime
        .getAll()
        .some(
          (session) =>
            session.chatStatus === "streaming" ||
            session.chatStatus === "submitted"
        );

      if (hasActiveStreaming) {
        return { skipped: true, reason: "active_streaming" };
      }

      const compactBeforeTs =
        Date.now() - Math.max(1, ENV.sqliteRetentionHotDays) * MS_PER_DAY;
      const compaction = await compactSessionMessages.execute({
        beforeTimestamp: compactBeforeTs,
        batchSize: ENV.sqliteRetentionCompactionBatchSize,
      });
      const maintenance = await runSqliteRuntimeMaintenance();
      const stats = await sessionRepo.getStorageStats();
      const dbSizeMb =
        Math.round((stats.dbSizeBytes / (1024 * 1024)) * 100) / 100;

      if (dbSizeMb >= ENV.sqliteMaxDbSizeMb) {
        logger.warn("SQLite DB size exceeded soft threshold", {
          dbSizeMb,
          thresholdMb: ENV.sqliteMaxDbSizeMb,
        });
      }

      return {
        compacted: compaction.compacted,
        checkpointRan: maintenance.checkpointRan,
        checkpointBusy: maintenance.checkpointBusy,
        pagesToVacuum: maintenance.pagesToVacuum,
        dbSizeMb,
      };
    },
  };
}
