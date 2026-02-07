import type { LoggerPort } from "@/shared/ports/logger.port";
import {
  createLogger,
  type LogTag,
  type StructuredLogger,
} from "./structured-logger";

class StructuredLoggerAdapter implements LoggerPort {
  private readonly logger: StructuredLogger;

  constructor(logger: StructuredLogger) {
    this.logger = logger;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(message, undefined, context);
  }
}

export function createAppLogger(tag: LogTag): LoggerPort {
  return new StructuredLoggerAdapter(createLogger(tag));
}
