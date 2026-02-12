/**
 * Sessions Routes
 *
 * API endpoints for session management (stop, delete).
 *
 * Endpoints:
 * - POST   /api/sessions/stop    - Stop a session (API)
 * - DELETE /api/sessions         - Delete a session (API)
 *
 * @module transport/http/routes/sessions
 */

import type { Context, Hono } from "hono";
import type { HttpRouteDependencies } from "./deps";

/**
 * Registers session-related HTTP routes
 */
export function registerSessionRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "sessionServices" | "resolveAuthContext">
): void {
  const { sessionServices, resolveAuthContext } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/sessions/stop - Stop a running session
   */
  api.post("/sessions/stop", async (c: Context) => {
    const auth = await resolveAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const service = sessionServices.stopSession();
    await service.execute(auth.userId, chatId);

    return c.json({ ok: true });
  });

  /**
   * DELETE /api/sessions - Delete a session
   */
  api.delete("/sessions", async (c: Context) => {
    const auth = await resolveAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const service = sessionServices.deleteSession();
    await service.execute(auth.userId, chatId);
    return c.json({ ok: true });
  });
}
