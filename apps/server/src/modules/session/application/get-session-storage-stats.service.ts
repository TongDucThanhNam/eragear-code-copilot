import type { SessionRepositoryPort } from "./ports/session-repository.port";
import { SessionQueries } from "./queries/session-queries";

/**
 * Compatibility wrapper for storage stats reads.
 *
 * Caller contract: new primary-path callers should use
 * `SessionQueries.storageStats`; this wrapper preserves older service imports.
 */
export class GetSessionStorageStatsService {
  private readonly queries: SessionQueries;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.queries = new SessionQueries(sessionRepo);
  }

  execute() {
    return this.queries.storageStats();
  }
}
