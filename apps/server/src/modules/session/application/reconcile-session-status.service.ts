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

  execute(): { updated: number } {
    const storedSessions = this.sessionRepo.findAll();
    let updated = 0;

    for (const session of storedSessions) {
      if (session.status !== "running") {
        continue;
      }
      if (this.sessionRuntime.has(session.id)) {
        continue;
      }
      this.sessionRepo.updateStatus(session.id, "stopped", {
        touchLastActiveAt: false,
      });
      updated += 1;
    }

    return { updated };
  }
}
