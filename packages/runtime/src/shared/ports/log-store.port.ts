import type { LogEntry, LogQuery, LogStats } from "../types/log.types";

/**
 * Result returned by log-store reads.
 *
 * Invariant: `stats` describes the same filtered view as `entries`, not global
 * process counters unless the query itself is global.
 */
export interface LogListResult {
  entries: LogEntry[];
  stats: LogStats;
}

/**
 * Runtime log persistence/read port.
 *
 * Side effects: `append` is intentionally synchronous at the port level and may
 * buffer; callers that need durability before shutdown must call `flush`.
 */
export interface LogStorePort {
  append(entry: LogEntry): void;
  list(query?: LogQuery): LogListResult;
  query(query?: LogQuery): Promise<LogListResult>;
  subscribe(listener: (entry: LogEntry) => void): () => void;
  flush(): Promise<void>;
}
