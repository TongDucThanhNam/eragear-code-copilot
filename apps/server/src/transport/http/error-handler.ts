/**
 * HTTP Error Handler
 *
 * Centralized error handling middleware for consistent error responses
 * and logging across the application.
 *
 * @module transport/http/error-handler
 */

import type { Context } from "hono";
import { ENV } from "@/config/environment";
import { isAppError } from "@/shared/errors";
import { getObservabilityContext } from "@/shared/utils/observability-context.util";

export interface ErrorResponse {
  error: string;
  code?: string;
  module?: string;
  op?: string;
  message?: string;
  path?: string;
  requestId?: string;
  timestamp?: string;
}

function isStatusCode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
  );
}

function resolveFallbackErrorShape(err: unknown): {
  code: string;
  statusCode: number;
  module?: string;
  op?: string;
} {
  if (err && typeof err === "object") {
    const candidate = err as Record<string, unknown>;
    const statusCode = isStatusCode(candidate.statusCode)
      ? candidate.statusCode
      : 500;
    const code =
      typeof candidate.code === "string" && candidate.code.length > 0
        ? candidate.code
        : "INTERNAL_SERVER_ERROR";
    const module =
      typeof candidate.module === "string" ? candidate.module : undefined;
    const op = typeof candidate.op === "string" ? candidate.op : undefined;
    return { code, statusCode, module, op };
  }
  return { code: "INTERNAL_SERVER_ERROR", statusCode: 500 };
}

function resolvePublicMessage(statusCode: number): string {
  if (statusCode === 401) {
    return "Unauthorized";
  }
  if (statusCode === 403) {
    return "Forbidden";
  }
  if (statusCode === 404) {
    return "Not found";
  }
  if (statusCode === 429) {
    return "Too many requests";
  }
  if (statusCode >= 400 && statusCode < 500) {
    return "Request failed";
  }
  return "Internal server error";
}

export interface ErrorHandlerPolicy {
  exposeInternalDetails?: boolean;
  logger?: ErrorHandlerLogger;
}

interface ErrorHandlerLogger {
  error(message: string, error: Error, context?: Record<string, unknown>): void;
}

/**
 * Creates an error handler middleware for Hono
 *
 * Handles all unhandled exceptions and converts them to consistent JSON responses
 *
 * @returns Error handler middleware
 */
export function createErrorHandler(policy: ErrorHandlerPolicy = {}) {
  const exposeInternalDetails = policy.exposeInternalDetails ?? ENV.isDev;
  const logger = policy.logger;

  return (err: Error, c: Context) => {
    const context = getObservabilityContext();
    const requestId =
      context?.requestId ||
      ((c.get("requestId") as string | undefined) ??
        c.req.header("x-request-id")) ||
      "unknown";
    const path = c.req.path;
    const method = c.req.method;

    const { code, statusCode, module, op } = isAppError(err)
      ? {
          code: err.code,
          statusCode: err.statusCode,
          module: err.module,
          op: err.op,
        }
      : resolveFallbackErrorShape(err);

    logger?.error("HTTP request failed", err, {
      requestId,
      method,
      path,
      statusCode,
      code,
      module: module ?? "unknown",
      op: op ?? "unknown",
      message: err.message,
      stack: err.stack,
    });

    const response: ErrorResponse = exposeInternalDetails
      ? {
          error: err.message || "An unexpected error occurred",
          code,
          module,
          op,
          path,
          requestId,
          timestamp: new Date().toISOString(),
        }
      : {
          error: resolvePublicMessage(statusCode),
          code,
          requestId,
          timestamp: new Date().toISOString(),
        };

    return new Response(JSON.stringify(response), {
      status: statusCode,
      headers: {
        "content-type": "application/json; charset=UTF-8",
      },
    });
  };
}

const defaultErrorHandler = createErrorHandler();

/**
 * Wraps an async handler to catch errors
 *
 * @param handler - Async request handler
 * @returns Wrapped handler with error catching
 */
export function withErrorHandling(handler: (c: Context) => Promise<Response>) {
  return async (c: Context) => {
    try {
      return await handler(c);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return await defaultErrorHandler(error, c);
    }
  };
}
