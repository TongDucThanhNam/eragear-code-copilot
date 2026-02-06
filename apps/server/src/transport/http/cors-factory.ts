/**
 * CORS Middleware Factory
 *
 * Factory functions to create consistent CORS middleware configurations
 * throughout the application.
 *
 * @module transport/http/cors-factory
 */

import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { CORS_DEFAULTS } from "./constants";
import { resolveCorsOrigin } from "./cors";

/**
 * CORS configuration presets
 */
export const CORS_PRESETS = {
  /** Authenticated API endpoints - strict CORS */
  api: {
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  } as const,

  /** Public auth endpoints - flexible CORS */
  auth: {
    allowMethods: ["POST", "GET", "OPTIONS"],
    credentials: true,
  } as const,

  /** Health check - open CORS */
  health: {
    allowMethods: ["GET", "OPTIONS"],
    credentials: false,
  } as const,

  /** Static assets - no CORS needed */
  static: {
    allowMethods: ["GET", "OPTIONS"],
    credentials: false,
  } as const,
} as const;

/**
 * Creates a CORS middleware with standard configuration
 *
 * @param preset - CORS preset to use ('api', 'auth', 'health', 'static')
 * @param trustedOrigins - Trusted origins list or '*'
 * @returns CORS middleware
 *
 * @example
 * ```typescript
 * app.use("/api/*", createCorsMiddleware("api", authConfig.trustedOrigins));
 * app.use("/api/auth/*", createCorsMiddleware("auth", authConfig.trustedOrigins));
 * ```
 */
export function createCorsMiddleware(
  preset: keyof typeof CORS_PRESETS,
  trustedOrigins: string[] | string = "*",
  strictOrigin = true
): MiddlewareHandler {
  const config = CORS_PRESETS[preset];

  const corsOptions = {
    origin: (origin: string | undefined) =>
      resolveCorsOrigin(origin, trustedOrigins, strictOrigin),
    allowHeaders: [...CORS_DEFAULTS.allowHeaders],
    allowMethods: [...config.allowMethods],
    credentials: config.credentials,
    exposeHeaders: [...CORS_DEFAULTS.exposeHeaders],
    maxAge: CORS_DEFAULTS.maxAge,
  };

  return cors(corsOptions);
}

/**
 * Creates multiple CORS middlewares for different route groups
 *
 * Useful for applying CORS to multiple routes with consistent configuration
 *
 * @param trustedOrigins - Trusted origins list or '*'
 * @returns Object with middleware creators
 *
 * @example
 * ```typescript
 * const corsMiddleware = createCorsMiddlewares(authConfig.trustedOrigins);
 * app.use("/api/*", corsMiddleware.api);
 * app.use("/api/auth/*", corsMiddleware.auth);
 * app.use("/api/health", corsMiddleware.health);
 * ```
 */
export function createCorsMiddlewares(
  trustedOrigins: string[] | string = "*",
  strictOrigin = true
) {
  return {
    api: createCorsMiddleware("api", trustedOrigins, strictOrigin),
    auth: createCorsMiddleware("auth", trustedOrigins, strictOrigin),
    health: createCorsMiddleware("health", trustedOrigins, strictOrigin),
    static: createCorsMiddleware("static", trustedOrigins, strictOrigin),
  };
}
