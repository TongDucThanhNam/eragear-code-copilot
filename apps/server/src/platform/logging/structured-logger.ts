/**
 * Structured Logger
 *
 * Centralized logging utility for consistent error/warning/debug output.
 * Provides tagged context for easier debugging and log filtering.
 *
 * @module infra/logging/structured-logger
 */

import type { LogLevel as SharedLogLevel } from "@/shared/types/log.types";
import { shouldEmitRuntimeLog } from "./runtime-log-level";

export type LogLevel = SharedLogLevel;

export type LogTag =
  | "Server"
  | "Auth"
  | "CORS"
  | "WebSocket"
  | "tRPC"
  | "Storage"
  | "Debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  tag: LogTag;
  message: string;
  error?: Error;
  context?: Record<string, unknown>;
}

/**
 * Formats a log entry into a readable string
 *
 * @param entry - Log entry to format
 * @returns Formatted log string
 */
function formatLogEntry(entry: LogEntry): string {
  const timestamp = entry.timestamp;
  const tag = `[${entry.tag}]`;
  const level = entry.level.toUpperCase().padEnd(5);
  const message = entry.message;
  const context =
    entry.context && Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : "";
  const error = entry.error ? `\n${entry.error.stack}` : "";

  return `${timestamp} ${level} ${tag} ${message}${context}${error}`;
}

/**
 * StructuredLogger - centralized logging utility
 *
 * @example
 * ```typescript
 * const logger = new StructuredLogger("Server");
 * logger.info("Server started on port 3000");
 * logger.error("Failed to connect", error);
 * logger.debug("Request received", { method: "POST", path: "/api/users" });
 * ```
 */
export class StructuredLogger {
  private readonly tag: LogTag;

  constructor(tag: LogTag) {
    this.tag = tag;
  }

  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    if (!shouldEmitRuntimeLog(level)) {
      return;
    }
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      tag: this.tag,
      message,
      error,
      context,
    };

    const formatted = formatLogEntry(entry);

    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.log(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
      default:
        console.log(formatted);
        break;
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, undefined, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, undefined, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, undefined, context);
  }

  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    this.log("error", message, error, context);
  }
}

/**
 * Factory function to create a logger with a specific tag
 *
 * @param tag - Log tag/context identifier
 * @returns StructuredLogger instance
 */
export function createLogger(tag: LogTag): StructuredLogger {
  return new StructuredLogger(tag);
}
