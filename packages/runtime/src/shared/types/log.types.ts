export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const LOG_OUTPUT_FORMATS = ["text", "json"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogOutputFormat = (typeof LOG_OUTPUT_FORMATS)[number];

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
  userId?: string;
  source?: string;
  requestId?: string;
  traceId?: string;
  chatId?: string;
  taskName?: string;
  taskRunId?: string;
  request?: LogRequestMeta;
  error?: {
    message?: string;
    stack?: string;
  };
  meta?: Record<string, string | number | boolean | null>;
}

export interface LogQuery {
  userId?: string;
  levels?: LogLevel[];
  sources?: string[];
  acpOnly?: boolean;
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
