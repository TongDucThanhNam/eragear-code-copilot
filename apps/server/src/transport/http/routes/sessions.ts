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
import { getContainer } from "../../../bootstrap/container";
import { getAuthContextFromRequest } from "../utils/auth";

/**
 * Registers session-related HTTP routes
 */
export function registerSessionRoutes(api: Hono): void {
  const container = getContainer();

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/sessions/stop - Stop a running session
   */
  api.post("/sessions/stop", async (c: Context) => {
    const auth = await getAuthContextFromRequest({
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

    const service = container.getSessionServices().stopSession();
    await service.execute(auth.userId, chatId);

    return c.json({ ok: true });
  });

  /**
   * DELETE /api/sessions - Delete a session
   */
  api.delete("/sessions", async (c: Context) => {
    const auth = await getAuthContextFromRequest({
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

    const service = container.getSessionServices().deleteSession();
    await service.execute(auth.userId, chatId);
    return c.json({ ok: true });
  });
}
