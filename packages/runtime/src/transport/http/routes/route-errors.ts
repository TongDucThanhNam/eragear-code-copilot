import type { Context } from "hono";
import { isAppError } from "../../../shared/errors";
import type { LoggerPort } from "../../../shared/ports/logger.port";
import { isJsonBodyParseError } from "./helpers";

type ErrorResponseStatus = 400 | 401 | 404 | 409 | 413 | 500;

const ERROR_RESPONSE_STATUSES = new Set<number>([400, 401, 404, 409, 413, 500]);

export interface RouteErrorResponseOptions {
  logger: LoggerPort;
  logMessage: string;
  fallbackMessage: string;
  fallbackStatus: ErrorResponseStatus;
  exposeUnexpectedErrorMessage?: boolean;
}

/**
 * Applies the shared HTTP JSON/action route error policy.
 *
 * Known validation/application errors keep their message and status. Unexpected
 * errors are logged and then mapped according to the route's fallback contract.
 */
export function respondToRouteError(
  c: Context,
  error: unknown,
  options: RouteErrorResponseOptions
): Response {
  if (isJsonBodyParseError(error)) {
    return c.json({ error: error.message }, error.statusCode);
  }
  if (isAppError(error)) {
    return c.json(
      { error: error.message },
      normalizeErrorStatus(error.statusCode, options.fallbackStatus)
    );
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  options.logger.error(options.logMessage, { error: errorMessage });

  if (options.exposeUnexpectedErrorMessage && error instanceof Error) {
    return c.json({ error: error.message }, options.fallbackStatus);
  }

  return c.json({ error: options.fallbackMessage }, options.fallbackStatus);
}

function normalizeErrorStatus(
  statusCode: number,
  fallbackStatus: ErrorResponseStatus
): ErrorResponseStatus {
  if (ERROR_RESPONSE_STATUSES.has(statusCode)) {
    return statusCode as ErrorResponseStatus;
  }
  return fallbackStatus;
}
