/**
 * Structured logging contract used by application services.
 *
 * Invariant: context values must be safe for logs; callers must not pass
 * secrets, raw tokens, or unredacted user payloads.
 */
export interface LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
