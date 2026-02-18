import type { AppConfigService } from "@/modules/settings";
import { updateSqliteWorkerRuntimeConfig } from "@/platform/storage/sqlite-worker-client";
import type { LoggerPort } from "@/shared/ports/logger.port";

export interface SqliteWorkerRuntimeConfigSync {
  enqueue(config: ReturnType<AppConfigService["getConfig"]>): void;
  flush(): Promise<void>;
}

export function createSqliteWorkerRuntimeConfigSync(
  logger: LoggerPort
): SqliteWorkerRuntimeConfigSync {
  let tail = Promise.resolve();

  const enqueue = (config: ReturnType<AppConfigService["getConfig"]>) => {
    tail = tail
      .catch(() => undefined)
      .then(async () => {
        await updateSqliteWorkerRuntimeConfig(config);
      })
      .catch((error) => {
        logger.error("Failed to sync runtime config to sqlite worker", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return {
    enqueue,
    async flush() {
      await tail.catch(() => undefined);
    },
  };
}
