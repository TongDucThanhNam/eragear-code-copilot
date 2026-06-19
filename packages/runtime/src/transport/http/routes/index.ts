/**
 * HTTP Routes Index
 *
 * Central entry point for HTTP route registration.
 * Delegates to feature-specific route modules.
 *
 * ## Route Modules
 *
 * | Module | Endpoints |
 * |--------|-----------|
 * | settings | `/api/ui-settings` |
 * | dashboard-api | `/api/dashboard/*`, `/api/logs/*` |
 * | blobs | `/api/blobs/*` |
 * | sessions | `/api/sessions/*` |
 * | projects | `/api/projects/*` |
 * | agents | `/api/agents/*` |
 * | admin | `/api/admin/*` |
 *
 * @module transport/http/routes
 */

import type { Hono } from "hono";
// Feature route modules
import { registerAdminRoutes } from "./admin";
import { registerAgentRoutes } from "./agents";
import { registerBlobRoutes } from "./blobs";
import { registerDashboardApiRoutes } from "./dashboard-api";
import type { HttpRouteDependencies } from "./deps";
import { registerProjectRoutes } from "./projects";
import { registerSessionRoutes } from "./sessions";
import { registerSettingsRoutes } from "./settings";

/**
 * Registers all HTTP routes
 *
 * This function serves as the central registry for all HTTP endpoints.
 * Each route group is registered through a dedicated module function.
 *
 * @param app - Hono app instance
 *
 * @example
 * ```typescript
 * const api = new Hono();
 * const form = new Hono();
 * registerHttpRoutes(api, deps);
 * app.route("/api", api);
 * ```
 */
export function registerHttpRoutes(
  api: Hono,
  deps: HttpRouteDependencies
): void {
  // Register feature routes in logical order
  registerSettingsRoutes(api, deps); // Settings must be first (used by dashboard)
  registerDashboardApiRoutes(api, deps); // Dashboard data & streams
  registerBlobRoutes(api, deps); // Out-of-band blob payload streaming
  registerSessionRoutes(api, deps); // Session management
  registerProjectRoutes(api, deps); // Project CRUD
  registerAgentRoutes(api, deps); // Agent configuration
  registerAdminRoutes(api, deps); // Admin operations (API keys, device sessions)
}
