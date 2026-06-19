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
import { requireRouteUserId } from "./route-auth";
import { parseSessionActionRouteInput } from "./session-route-input";

/**
 * Registers session-related HTTP routes
 */
export function registerSessionRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "useCases" | "resolveAuthContext">
): void {
  const { useCases, resolveAuthContext } = deps;

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/sessions/stop - Stop a running session
   */
  api.post("/sessions/stop", async (c: Context) => {
    const auth = await requireRouteUserId(c, resolveAuthContext);
    if (!auth.ok) {
      return auth.response;
    }
    const parsedInput = parseSessionActionRouteInput(await c.req.parseBody());
    if (!parsedInput.ok) {
      return c.json({ error: parsedInput.error }, 400);
    }

    const service = useCases.session.stop;
    await service.execute(auth.userId, parsedInput.input.chatId);

    return c.json({ ok: true });
  });

  /**
   * DELETE /api/sessions - Delete a session
   */
  api.delete("/sessions", async (c: Context) => {
    const auth = await requireRouteUserId(c, resolveAuthContext);
    if (!auth.ok) {
      return auth.response;
    }
    const parsedInput = parseSessionActionRouteInput(await c.req.parseBody());
    if (!parsedInput.ok) {
      return c.json({ error: parsedInput.error }, 400);
    }

    const service = useCases.session.delete;
    await service.execute(auth.userId, parsedInput.input.chatId);
    return c.json({ ok: true });
  });
}
