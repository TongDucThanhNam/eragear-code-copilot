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
 * | settings | `/api/ui-settings`, `/form/settings` |
 * | dashboard | `/api/dashboard/*`, `/api/logs/*` |
 * | sessions | `/api/sessions/*`, `/form/sessions/*` |
 * | projects | `/api/projects/*`, `/form/projects/*` |
 * | agents | `/api/agents/*`, `/form/agents/*` |
 * | admin | `/api/admin/*`, `/form/admin/*` |
 *
 * @module transport/http/routes
 */

import type { Hono } from "hono";

// Feature route modules
import { registerAdminRoutes } from "./admin";
import { registerAgentRoutes } from "./agents";
import { registerDashboardRoutes } from "./dashboard";
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
 * registerHttpRoutes(api, form);
 * app.route("/api", api);
 * app.route("/form", form);
 * ```
 */
export function registerHttpRoutes(api: Hono, form: Hono): void {
  // Register feature routes in logical order
  registerSettingsRoutes(api, form);   // Settings must be first (used by dashboard)
  registerDashboardRoutes(api);        // Dashboard data & streams
  registerSessionRoutes(api, form);    // Session management
  registerProjectRoutes(api, form);    // Project CRUD
  registerAgentRoutes(api, form);      // Agent configuration
  registerAdminRoutes(api, form);      // Admin operations (API keys, device sessions)
}

// Re-export individual route registrations for direct use if needed
export {
  registerAdminRoutes,
  registerAgentRoutes,
  registerDashboardRoutes,
  registerProjectRoutes,
  registerSessionRoutes,
  registerSettingsRoutes,
};
