/**
 * Admin Routes
 *
 * API endpoints for admin operations (API keys, device sessions).
 *
 * Endpoints:
 * - GET    /api/admin/api-keys                   - List API keys
 * - POST   /api/admin/api-keys                   - Create API key
 * - DELETE /api/admin/api-keys                   - Delete API key
 * - GET    /api/admin/device-sessions            - List device sessions
 * - POST   /api/admin/device-sessions/revoke     - Revoke device session
 * - POST   /api/admin/device-sessions/activate   - Activate device session
 *
 * @module transport/http/routes/admin
 */

import type { Context, Hono } from "hono";
import {
  parseCreateApiKeyRouteInput,
  parseDeleteApiKeyRouteInput,
  parseDeviceSessionRouteInput,
} from "./admin-route-input";
import {
  normalizeApiKeyCreateResponse,
  normalizeApiKeyItem,
  normalizeDeviceSessionItem,
} from "./auth-management-data";
import type { HttpRouteDependencies } from "./deps";
import { parseJsonBodyWithLimit } from "./helpers";
import { respondToRouteError } from "./route-errors";

/**
 * Registers admin-related HTTP routes
 */
export function registerAdminRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "auth" | "logger" | "runtime">
): void {
  const { auth, logger, runtime } = deps;

  // =========================================================================
  // API Routes - API Keys
  // =========================================================================

  /**
   * GET /api/admin/api-keys - List all API keys
   */
  api.get("/admin/api-keys", async (c: Context) => {
    try {
      const keys = await auth.api.listApiKeys({
        headers: c.req.raw.headers,
      });
      const normalized = Array.isArray(keys)
        ? keys.map((item) => normalizeApiKeyItem(item as never))
        : [];
      return c.json({ keys: normalized });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to list API keys",
        fallbackMessage: "Failed to list API keys",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * POST /api/admin/api-keys - Create a new API key
   */
  api.post("/admin/api-keys", async (c: Context) => {
    try {
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseCreateApiKeyRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const created = await auth.api.createApiKey({
        body: {
          ...parsedInput.input,
          userId: session.user.id,
        },
      });

      const apiKey = normalizeApiKeyCreateResponse(
        created as {
          id: string;
          key: string;
          name: string | null;
          prefix: string | null;
          start: string | null;
          createdAt: string | Date;
        }
      );

      return c.json({ apiKey });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to create API key",
        fallbackMessage: "Failed to create API key",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * DELETE /api/admin/api-keys - Delete an API key
   */
  api.delete("/admin/api-keys", async (c: Context) => {
    try {
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseDeleteApiKeyRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const result = await auth.api.deleteApiKey({
        body: { keyId: parsedInput.input.keyId },
        headers: c.req.raw.headers,
      });
      return c.json({ result });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to delete API key",
        fallbackMessage: "Failed to delete API key",
        fallbackStatus: 500,
      });
    }
  });

  // =========================================================================
  // API Routes - Device Sessions
  // =========================================================================

  /**
   * GET /api/admin/device-sessions - List all device sessions
   */
  api.get("/admin/device-sessions", async (c: Context) => {
    try {
      const sessions = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });
      const normalized = Array.isArray(sessions)
        ? sessions.map((item) => normalizeDeviceSessionItem(item as never))
        : [];
      return c.json({ sessions: normalized });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to list device sessions",
        fallbackMessage: "Failed to list device sessions",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * POST /api/admin/device-sessions/revoke - Revoke a device session
   */
  api.post("/admin/device-sessions/revoke", async (c: Context) => {
    try {
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseDeviceSessionRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const result = await auth.api.revokeDeviceSession({
        body: { sessionToken: parsedInput.input.sessionToken },
        headers: c.req.raw.headers,
      });
      return c.json({ result });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to revoke device session",
        fallbackMessage: "Failed to revoke device session",
        fallbackStatus: 500,
      });
    }
  });

  /**
   * POST /api/admin/device-sessions/activate - Activate a device session
   */
  api.post("/admin/device-sessions/activate", async (c: Context) => {
    try {
      const payload = await parseJsonBodyWithLimit<unknown>(
        c.req.raw,
        runtime.httpMaxBodyBytes
      );
      const parsedInput = parseDeviceSessionRouteInput(payload);
      if (!parsedInput.ok) {
        return c.json({ error: parsedInput.error }, 400);
      }

      const result = await auth.api.setActiveSession({
        body: { sessionToken: parsedInput.input.sessionToken },
        headers: c.req.raw.headers,
      });
      return c.json({ session: result });
    } catch (error) {
      return respondToRouteError(c, error, {
        logger,
        logMessage: "Failed to set active session",
        fallbackMessage: "Failed to set active session",
        fallbackStatus: 500,
      });
    }
  });
}
