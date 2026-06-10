/**
 * List Sessions Service
 *
 * Retrieves and formats all sessions with derived state from both runtime and storage.
 * Combines active session data with stored session metadata for a complete view.
 *
 * @module modules/session/application/list-sessions.service
 */

import type { ProjectRepositoryPort } from "@/modules/project/application/ports/project-repository.port";
import type {
  SessionListPageQuery,
  SessionListQuery,
  SessionRepositoryPort,
} from "./ports/session-repository.port";
import type { SessionRuntimePort } from "./ports/session-runtime.port";
import { SessionQueries } from "./queries/session-queries";

/**
 * Compatibility wrapper for session list reads.
 *
 * Caller contract: `SessionQueries.list` and `SessionQueries.listPage` are the
 * canonical read surface; this class delegates to avoid duplicate list logic.
 */
export class ListSessionsService {
  private readonly queries: SessionQueries;

  constructor(
    sessionRepo: SessionRepositoryPort,
    sessionRuntime: SessionRuntimePort,
    projectRepo: ProjectRepositoryPort
  ) {
    this.queries = new SessionQueries(sessionRepo, sessionRuntime, projectRepo);
  }

  async execute(
    userId: string,
    query: SessionListQuery | undefined,
    maxLimit: number
  ) {
    return await this.queries.list(userId, query, maxLimit);
  }

  async executePage(
    userId: string,
    query: SessionListPageQuery | undefined,
    maxLimit: number
  ) {
    return await this.queries.listPage(userId, query, maxLimit);
  }
}
