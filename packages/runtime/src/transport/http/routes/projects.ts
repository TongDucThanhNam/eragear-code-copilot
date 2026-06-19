/**
 * Projects Routes
 *
 * API endpoints for project management (CRUD).
 *
 * Endpoints:
 * - POST   /api/projects          - Create project (API)
 * - DELETE /api/projects          - Delete project (API)
 *
 * @module transport/http/routes/projects
 */

import type { Context, Hono } from "hono";
import type { HttpRouteDependencies } from "./deps";
import { parseJsonBodyWithLimit } from "./helpers";
import {
  parseCreateProjectRouteInput,
  parseDeleteProjectRouteInput,
} from "./project-route-input";
import { requireRouteUserId } from "./route-auth";
import { respondToRouteError } from "./route-errors";

/**
 * Registers project-related HTTP routes
 */
export function registerProjectRoutes(
  api: Hono,
  deps: Pick<
    HttpRouteDependencies,
    "useCases" | "logger" | "resolveAuthContext" | "runtime"
  >
): void {
  const { useCases, logger, resolveAuthContext, runtime } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/projects - Create a new project
   */
  api.post("/projects", async (c: Context) => {
    try {
      const auth = await requireRouteUserId(c, resolveAuthContext);
      if (!auth.ok) {
        return auth.response;
      }
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseCreateProjectRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const service = useCases.project.create;
      const project = await service.execute(auth.userId, parsedInput.input);

      return c.json({ ok: true, project });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to create project",
        fallbackMessage: "Failed to create project",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * DELETE /api/projects - Delete a project
   */
  api.delete("/projects", async (c: Context) => {
    try {
      const auth = await requireRouteUserId(c, resolveAuthContext);
      if (!auth.ok) {
        return auth.response;
      }
      const parsedInput = parseDeleteProjectRouteInput(await c.req.parseBody());
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const service = useCases.project.delete;
      await service.execute(auth.userId, parsedInput.input.projectId);

      return c.json({ ok: true });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to delete project",
        fallbackMessage: "Failed to delete project",
        fallbackStatus: 500,
      });
    }
  });
}
