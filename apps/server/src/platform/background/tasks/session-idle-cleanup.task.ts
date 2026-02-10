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
import { createLogger } from "@/platform/logging/structured-logger";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";

const logger = createLogger("Server");

export function createSessionIdleCleanupTask(params: {
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
}): BackgroundTaskSpec {
  const { sessionRuntime, sessionRepo } = params;

  return {
    name: "session-idle-cleanup",
    intervalMs: ENV.backgroundSessionCleanupIntervalMs,
    run: async () => {
      const now = Date.now();
      let checked = 0;
      let cleaned = 0;

      for (const session of sessionRuntime.getAll()) {
        checked += 1;

        if (session.subscriberCount > 0) {
          session.idleSinceAt = undefined;
          continue;
        }

        if (!session.idleSinceAt) {
          session.idleSinceAt = now;
          continue;
        }

        if (now - session.idleSinceAt < ENV.sessionIdleTimeoutMs) {
          continue;
        }

        terminateSessionTerminals(session);
        if (!session.proc.killed) {
          session.proc.kill("SIGTERM");
        }
        try {
          await sessionRepo.updateStatus(session.id, session.userId, "stopped");
          sessionRuntime.delete(session.id);
          cleaned += 1;
        } catch (error) {
          logger.error(
            "Failed to persist stopped session during idle cleanup",
            error as Error,
            {
              chatId: session.id,
            }
          );
        }
      }

      return { checked, cleaned };
    },
  };
}
