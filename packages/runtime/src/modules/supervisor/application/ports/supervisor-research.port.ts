/**
 * External research result included in supervisor context.
 *
 * Invariant: highlights must be short excerpts/summaries suitable for prompt
 * context; adapters must not return full article bodies.
 */
export interface SupervisorResearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights: string[];
}

/**
 * Optional supervisor web-research adapter.
 *
 * Caller contract: an empty result set is a valid no-op; provider failures
 * should be handled as unavailable context, not as failed prompt execution.
 */
export interface SupervisorResearchPort {
  search(query: string): Promise<SupervisorResearchResult[]>;
}
