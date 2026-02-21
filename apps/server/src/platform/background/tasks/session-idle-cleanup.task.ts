/**
 * Session Idle Cleanup Task
 *
 * Cleans up runtime sessions that have no subscribers after configured idle timeout.
 *
 * @module infra/background/tasks/session-idle-cleanup.task
 */

import { ENV } from "@/config/environment";
import type {
  SessionRepositoryPort,
  SessionRuntimePort,
} from "@/modules/session";
import type { AppConfigService } from "@/modules/settings";
import { createLogger } from "@/platform/logging/structured-logger";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";
import { terminateProcessGracefully } from "@/shared/utils/process-termination.util";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";

const logger = createLogger("Server");

export function createSessionIdleCleanupTask(params: {
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
  appConfig: AppConfigService;
}): BackgroundTaskSpec {
  const { sessionRuntime, sessionRepo, appConfig } = params;

  return {
    name: "session-idle-cleanup",
    intervalMs: ENV.backgroundSessionCleanupIntervalMs,
    run: async () => {
      const now = Date.now();
      const runtimeConfig = appConfig.getConfig();
      let checked = 0;
      let cleaned = 0;

      for (const session of sessionRuntime.getAll()) {
        checked += 1;
        await sessionRuntime.runExclusive(session.id, async () => {
          const currentSession = sessionRuntime.get(session.id);
          if (!currentSession || currentSession !== session) {
            return;
          }

          if (currentSession.subscriberCount > 0) {
            currentSession.idleSinceAt = undefined;
            return;
          }

          if (!currentSession.idleSinceAt) {
            currentSession.idleSinceAt = now;
            return;
          }

          if (
            now - currentSession.idleSinceAt <
            runtimeConfig.sessionIdleTimeoutMs
          ) {
            return;
          }

          await terminateSessionTerminals(currentSession);
          await terminateProcessGracefully(currentSession.proc, {
            forceWindowsTreeTermination: true,
          });
          try {
            await sessionRepo.updateStatus(
              currentSession.id,
              currentSession.userId,
              "stopped"
            );
            if (sessionRuntime.deleteIfMatch(currentSession.id, currentSession)) {
              cleaned += 1;
            }
          } catch (error) {
            logger.error(
              "Failed to persist stopped session during idle cleanup",
              error as Error,
              {
                chatId: currentSession.id,
              }
            );
          }
        });
      }

      return { checked, cleaned };
    },
  };
}
