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
import { isAppError } from "../../../shared/errors";
import { getAuthContextFromRequest } from "../utils/auth";
import type { HttpRouteDependencies } from "./deps";

/**
 * Registers project-related HTTP routes
 */
export function registerProjectRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "projectServices" | "logger">
): void {
  const { projectServices, logger } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/projects - Create a new project
   */
  api.post("/projects", async (c: Context) => {
    try {
      const auth = await getAuthContextFromRequest({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const body = await c.req.json();
      const { name, path, description, tags } = body as {
        name: string;
        path: string;
        description?: string;
        tags?: string[];
      };

      if (!(name && path)) {
        return c.json({ error: "name and path are required" }, 400);
      }

      const service = projectServices.createProject();
      const project = await service.execute(auth.userId, {
        name,
        path,
        description: description || null,
        tags: tags || [],
        favorite: false,
      });

      return c.json({ ok: true, project });
    } catch (error) {
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      logger.error("Failed to create project", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to create project" }, 500);
    }
  });

  /**
   * DELETE /api/projects - Delete a project
   */
  api.delete("/projects", async (c: Context) => {
    try {
      const auth = await getAuthContextFromRequest({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const body = await c.req.parseBody();
      const projectId = body.projectId as string;

      if (!projectId) {
        return c.json({ error: "projectId is required" }, 400);
      }

      const service = projectServices.deleteProject();
      await service.execute(auth.userId, projectId);

      return c.json({ ok: true });
    } catch (error) {
      if (isAppError(error)) {
        return c.json({ error: error.message }, error.statusCode as 400 | 404);
      }
      logger.error("Failed to delete project", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to delete project" }, 500);
    }
  });
}
