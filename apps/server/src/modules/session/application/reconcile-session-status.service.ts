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

    let offset = 0;
    while (true) {
      const storedSessions = await this.sessionRepo.findAll({
        limit: RECONCILE_PAGE_SIZE,
        offset,
      });
      if (storedSessions.length === 0) {
        break;
      }

      for (const session of storedSessions) {
        if (session.status !== "running") {
          continue;
        }
        if (this.sessionRuntime.has(session.id)) {
          continue;
        }
        await this.sessionRepo.updateStatus(session.id, "stopped", {
          touchLastActiveAt: false,
        });
        updated += 1;
      }

      if (storedSessions.length < RECONCILE_PAGE_SIZE) {
        break;
      }
      offset += storedSessions.length;
    }

    return { updated };
  }
}
