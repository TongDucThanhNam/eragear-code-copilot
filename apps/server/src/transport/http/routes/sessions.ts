/**
 * Sessions Routes
 *
 * API and form endpoints for session management (stop, delete).
 *
 * Endpoints:
 * - POST   /api/sessions/stop    - Stop a session (API)
 * - DELETE /api/sessions         - Delete a session (API)
 * - POST   /form/sessions/stop   - Stop session (HTML form)
 * - POST   /form/sessions/delete - Delete session (HTML form)
 *
 * @module transport/http/routes/sessions
 */

import type { Context, Hono } from "hono";
import { getContainer } from "../../../bootstrap/container";
import { DeleteSessionService } from "../../../modules/session/application/delete-session.service";
import { StopSessionService } from "../../../modules/session/application/stop-session.service";
import { type FormDataRecord, getFormValue, redirectWithParams } from "./helpers";

/**
 * Registers session-related HTTP routes
 */
export function registerSessionRoutes(api: Hono, form: Hono): void {
  const container = getContainer();

  // =========================================================================
  // API Routes
  // =========================================================================

  /**
   * POST /api/sessions/stop - Stop a running session
   */
  api.post("/sessions/stop", async (c: Context) => {
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const service = new StopSessionService(
      container.getSessions(),
      container.getSessionRuntime()
    );
    service.execute(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_stopped",
      chatId,
    });

    return c.json({ ok: true });
  });

  /**
   * DELETE /api/sessions - Delete a session
   */
  api.delete("/sessions", async (c: Context) => {
    const body = await c.req.parseBody();
    const chatId = body.chatId as string;

    if (!chatId) {
      return c.json({ error: "chatId is required" }, 400);
    }

    const service = new DeleteSessionService(
      container.getSessions(),
      container.getSessionRuntime()
    );
    service.execute(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_deleted",
      chatId,
    });
    return c.json({ ok: true });
  });

  // =========================================================================
  // Form Routes (HTML form submissions)
  // =========================================================================

  /**
   * POST /form/sessions/stop - Stop session via HTML form
   */
  form.post("/sessions/stop", async (c: Context) => {
    const body = await c.req.parseBody();
    const formData = body as FormDataRecord;
    const chatId = getFormValue(formData, "chatId");
    if (!chatId) {
      return redirectWithParams(c, {
        tab: "sessions",
        error: "chatId is required",
      });
    }

    const service = new StopSessionService(
      container.getSessions(),
      container.getSessionRuntime()
    );
    service.execute(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_stopped",
      chatId,
    });

    return redirectWithParams(c, { tab: "sessions" });
  });

  /**
   * POST /form/sessions/delete - Delete session via HTML form
   */
  form.post("/sessions/delete", async (c: Context) => {
    const body = await c.req.parseBody();
    const formData = body as FormDataRecord;
    const chatId = getFormValue(formData, "chatId");
    if (!chatId) {
      return redirectWithParams(c, {
        tab: "sessions",
        error: "chatId is required",
      });
    }

    const service = new DeleteSessionService(
      container.getSessions(),
      container.getSessionRuntime()
    );
    service.execute(chatId);
    container.getEventBus().publish({
      type: "dashboard_refresh",
      reason: "session_deleted",
      chatId,
    });
    return redirectWithParams(c, { tab: "sessions" });
  });
}
