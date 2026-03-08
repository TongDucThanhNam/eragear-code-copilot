import type { LogEntry, LogQuery, LogStats } from "../types/log.types";

export interface LogListResult {
  entries: LogEntry[];
  stats: LogStats;
}

export interface LogStorePort {
  append(entry: LogEntry): void;
  list(query?: LogQuery): LogListResult;
  query(query?: LogQuery): Promise<LogListResult>;
  subscribe(listener: (entry: LogEntry) => void): () => void;
  flush(): Promise<void>;
}
