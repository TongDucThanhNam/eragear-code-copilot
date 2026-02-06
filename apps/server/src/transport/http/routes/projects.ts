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
import { getContainer } from "../../../bootstrap/container";
import { isPathWithinRoots } from "../../../shared/utils/project-roots.util";

/**
 * Registers project-related HTTP routes
 */
export function registerProjectRoutes(api: Hono): void {
  const container = getContainer();

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/projects - Create a new project
   */
  api.post("/projects", async (c: Context) => {
    try {
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

      // Validate path is within allowed project roots
      const settings = container.getSettings().get();
      const isAllowed = isPathWithinRoots(path, settings.projectRoots);

      if (!isAllowed) {
        return c.json(
          {
            error: `Path must be within allowed project roots: ${settings.projectRoots.join(", ")}`,
          },
          400
        );
      }

      const project = container.getProjects().create({
        name,
        path,
        description: description || null,
        tags: tags || [],
        favorite: false,
      });

      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "project_created",
        projectId: project.id,
      });

      return c.json({ ok: true, project });
    } catch (error) {
      console.error("Failed to create project:", error);
      return c.json({ error: "Failed to create project" }, 500);
    }
  });

  /**
   * DELETE /api/projects - Delete a project
   */
  api.delete("/projects", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const projectId = body.projectId as string;

      if (!projectId) {
        return c.json({ error: "projectId is required" }, 400);
      }

      container.getProjects().delete(projectId);
      container.getEventBus().publish({
        type: "dashboard_refresh",
        reason: "project_deleted",
        projectId,
      });

      return c.json({ ok: true });
    } catch (error) {
      console.error("Failed to delete project:", error);
      return c.json({ error: "Failed to delete project" }, 500);
    }
  });
}
