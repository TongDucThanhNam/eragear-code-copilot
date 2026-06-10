import type { SessionRepositoryPort } from "./ports/session-repository.port";
import {
  type SessionMessagesCompactionInput,
  type SessionMessagesCompactionResult,
  SessionQueries,
} from "./queries/session-queries";

/**
 * Request contract for cold message compaction.
 *
 * Invariant: compaction is only valid for stopped sessions; active timelines
 * must be changed through the runtime/buffering path.
 */
export type CompactSessionMessagesInput = SessionMessagesCompactionInput;

/**
 * Result returned after cold message compaction.
 *
 * Caller need: counts describe persisted storage changes, not runtime UI state.
 */
export type CompactSessionMessagesResult = SessionMessagesCompactionResult;

/**
 * Compatibility wrapper for cold message compaction.
 *
 * Caller contract: background/lifecycle code should use `SessionQueries.compact`
 * through `AppUseCases.session.queries`; this class delegates to keep older
 * direct imports on the same stopped-session-only implementation.
 */
export class CompactSessionMessagesService {
  private readonly queries: SessionQueries;

  constructor(sessionRepo: SessionRepositoryPort) {
    this.queries = new SessionQueries(sessionRepo);
  }

  async execute(
    input: CompactSessionMessagesInput
  ): Promise<CompactSessionMessagesResult> {
    return await this.queries.compact(input);
  }
}
