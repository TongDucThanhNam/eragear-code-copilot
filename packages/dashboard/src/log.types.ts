export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
  request?: {
    method?: string;
    path?: string;
    status?: number;
    host?: string;
    durationMs?: number;
  };
  error?: {
    message?: string;
  };
  meta?: Record<string, unknown>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogQuery {
  acpOnly?: boolean;
  from?: number;
  order?: "asc" | "desc";
  limit?: number;
}

export function getLogSearchText(entry: LogEntry): string {
  const parts = [entry.message, entry.source, entry.request?.path].filter(
    Boolean
  );
  return parts.join(" ").toLowerCase();
}

export function matchesLogQuery(entry: LogEntry, query: LogQuery): boolean {
  if (query.acpOnly === true && !entry.source?.includes("acp")) {
    return false;
  }
  if (typeof query.from === "number" && entry.timestamp < query.from) {
    return false;
  }
  return true;
}