export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogRequestMeta {
  method: string;
  path: string;
  status: number;
  host?: string;
  durationMs?: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
  request?: LogRequestMeta;
  error?: {
    message?: string;
    stack?: string;
  };
  meta?: Record<string, string | number | boolean | null>;
}

export interface LogQuery {
  levels?: LogLevel[];
  search?: string;
  from?: number;
  to?: number;
  limit?: number;
  order?: "asc" | "desc";
}

export interface LogStats {
  total: number;
  levels: Record<LogLevel, number>;
}
