/**
 * HTTP Error Handler
 *
 * Centralized error handling middleware for consistent error responses
 * and logging across the application.
 *
 * @module transport/http/error-handler
 */

import type { Context } from "hono";
import { createLogger } from "../../infra/logging/structured-logger";

const logger = createLogger("Server");

export interface ErrorResponse {
  error: string;
  code?: string;
  message?: string;
  path?: string;
  requestId?: string;
  timestamp?: string;
}

/**
 * Creates an error handler middleware for Hono
 *
 * Handles all unhandled exceptions and converts them to consistent JSON responses
 *
 * @returns Error handler middleware
 */
export function createErrorHandler() {
  return async (err: Error, c: Context) => {
    const requestId = c.req.header("x-request-id") || "unknown";
    const path = c.req.path;
    const method = c.req.method;

    // Log error with context
    logger.error(`Unhandled error: ${err.message}`, err, {
      method,
      path,
      requestId,
    });

    // Determine status code based on error type
    let statusCode = 500;
    let errorCode = "INTERNAL_SERVER_ERROR";

    if (err.message.includes("not found")) {
      statusCode = 404;
      errorCode = "NOT_FOUND";
    } else if (err.message.includes("unauthorized")) {
      statusCode = 401;
      errorCode = "UNAUTHORIZED";
    } else if (err.message.includes("forbidden")) {
      statusCode = 403;
      errorCode = "FORBIDDEN";
    }

    // Return consistent error response
    const response: ErrorResponse = {
      error: err.message || "An unexpected error occurred",
      code: errorCode,
      path,
      requestId,
      timestamp: new Date().toISOString(),
    };

    return await c.json(response, { status: statusCode } as any);
  };
}

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
      const errorHandler = createErrorHandler();
      return await errorHandler(error, c);
    }
  };
}
