/**
 * Reconcile Session Status Service
 *
 * Ensures persisted session statuses match the runtime state.
 * Marks sessions as stopped when they are not active in runtime.
 *
 * @module modules/session/application/reconcile-session-status.service
 */

import type { SessionRepositoryPort } from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";

const RECONCILE_PAGE_SIZE = 200;

export class ReconcileSessionStatusService {
  private readonly sessionRepo: SessionRepositoryPort;
  private readonly sessionRuntime: SessionRuntimePort;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort
  ) {
    this.sessionRepo = sessionRepo;
    this.sessionRuntime = sessionRuntime;
  }

  async execute(): Promise<{ updated: number }> {
    let updated = 0;
    let cursor: string | undefined;
    while (true) {
      const page = await this.sessionRepo.findPageForMaintenance({
        limit: RECONCILE_PAGE_SIZE,
        cursor,
      });
      if (page.sessions.length === 0) {
        break;
      }

      for (const session of page.sessions) {
        if (session.status !== "running") {
          continue;
        }
        if (this.sessionRuntime.has(session.id)) {
          continue;
        }
        if (!session.userId) {
          continue;
        }
        await this.sessionRepo.updateStatus(
          session.id,
          session.userId,
          "stopped",
          {
            touchLastActiveAt: false,
          }
        );
        updated += 1;
      }

      if (!(page.hasMore && page.nextCursor)) {
        break;
      }
      cursor = page.nextCursor;
    }

    return { updated };
  }
}
