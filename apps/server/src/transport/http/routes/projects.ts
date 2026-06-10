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
import type { HttpRouteDependencies } from "./deps";
import { isJsonBodyParseError, parseJsonBodyWithLimit } from "./helpers";

interface CreateProjectPayload {
  name: string;
  path: string;
  description?: string;
  tags?: string[];
  obsidianProjectPath?: string | null;
  techStackTags?: string[];
}

interface CreateProjectRouteInput {
  name: string;
  path: string;
  description: string | null;
  tags: string[];
  obsidianProjectPath: string | null;
  techStackTags: string[];
  favorite: false;
}

async function readCreateProjectInput(
  request: Request,
  maxBodyBytes: number
): Promise<CreateProjectRouteInput> {
  const payload = await parseJsonBodyWithLimit<CreateProjectPayload>(
    request,
    maxBodyBytes
  );
  return {
    name: typeof payload.name === "string" ? payload.name : "",
    path: typeof payload.path === "string" ? payload.path : "",
    description:
      typeof payload.description === "string"
        ? payload.description || null
        : null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    obsidianProjectPath:
      typeof payload.obsidianProjectPath === "string"
        ? payload.obsidianProjectPath
        : null,
    techStackTags: Array.isArray(payload.techStackTags)
      ? payload.techStackTags
      : [],
    favorite: false,
  };
}

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
      const auth = await resolveAuthContext({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
        remoteAddress: c.req.header("x-eragear-remote-address"),
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const input = await readCreateProjectInput(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );

      if (!(input.name && input.path)) {
        return c.json({ error: "name and path are required" }, 400);
      }

      const service = useCases.project.create;
      const project = await service.execute(auth.userId, input);

      return c.json({ ok: true, project });
    } catch (error) {
      if (isJsonBodyParseError(error)) {
        return c.json({ error: error.message }, error.statusCode);
      }
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
      const auth = await resolveAuthContext({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
        remoteAddress: c.req.header("x-eragear-remote-address"),
      });
      if (!auth) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const body = await c.req.parseBody();
      const projectId = body.projectId as string;

      if (!projectId) {
        return c.json({ error: "projectId is required" }, 400);
      }

      const service = useCases.project.delete;
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
