/**
 * Session Idle Cleanup Task
 *
 * Cleans up runtime sessions that have no subscribers after configured idle timeout.
 *
 * @module infra/background/tasks/session-idle-cleanup.task
 */

import { ENV } from "@/config/environment";
import type { SessionRepositoryPort } from "@/modules/session/application/ports/session-repository.port";
import type { SessionRuntimePort } from "@/modules/session/application/ports/session-runtime.port";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";
import { terminateSessionTerminals } from "@/shared/utils/session-cleanup.util";

export function createSessionIdleCleanupTask(params: {
  sessionRuntime: SessionRuntimePort;
  sessionRepo: SessionRepositoryPort;
}): BackgroundTaskSpec {
  const { sessionRuntime, sessionRepo } = params;

  return {
    name: "session-idle-cleanup",
    intervalMs: ENV.backgroundSessionCleanupIntervalMs,
    run: () => {
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
          session.proc.kill();
        }
        sessionRuntime.delete(session.id);
        sessionRepo.updateStatus(session.id, "stopped");
        cleaned += 1;
      }

      return { checked, cleaned };
    },
  };
}
