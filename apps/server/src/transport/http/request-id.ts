/**
 * Request ID Middleware
 *
 * Adds unique request IDs for tracing and debugging.
 * If a request already has an x-request-id header, it will be preserved.
 *
 * @module transport/http/request-id
 */

import type { MiddlewareHandler } from "hono";
import { createId } from "../../shared/utils/id.util";

/**
 * Middleware that adds or preserves request IDs
 *
 * - Uses existing x-request-id header if provided
 * - Generates new UUID v4 ID if not present
 * - Makes ID available via c.get("requestId")
 * - Adds ID to response header for tracing
 *
 * @returns Request ID middleware
 *
 * @example
 * ```typescript
 * app.use(requestIdMiddleware());
 * // Later in handlers:
 * const requestId = c.get("requestId");
 * logger.info("Processing request", { requestId });
 * ```
 */
export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Use existing request ID or generate new one
    const requestId = c.req.header("x-request-id") || createId("req");

    // Store in context for use in handlers
    c.set("requestId", requestId);

    // Process request
    await next();

    // Add ID to response header for client tracing
    c.res.headers.set("x-request-id", requestId);
  };
}
