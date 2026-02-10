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
import type { HttpRouteDependencies } from "./deps";
import {
  normalizeApiKeyCreateResponse,
  normalizeApiKeyItem,
  normalizeDeviceSessionItem,
} from "./helpers";

/**
 * Registers admin-related HTTP routes
 */
export function registerAdminRoutes(
  api: Hono,
  deps: Pick<HttpRouteDependencies, "auth" | "logger">
): void {
  const { auth, logger } = deps;

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
      logger.error("Failed to list API keys", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to list API keys" }, 500);
    }
  });

  /**
   * POST /api/admin/api-keys - Create a new API key
   */
  api.post("/admin/api-keys", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { name, prefix, expiresIn } = body as {
        name?: string;
        prefix?: string;
        expiresIn?: number;
      };

      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const created = await auth.api.createApiKey({
        body: {
          name,
          prefix,
          expiresIn,
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
      logger.error("Failed to create API key", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to create API key" }, 500);
    }
  });

  /**
   * DELETE /api/admin/api-keys - Delete an API key
   */
  api.delete("/admin/api-keys", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { keyId, id } = body as { keyId?: string; id?: string };
      const resolvedKeyId = keyId ?? id;
      if (!resolvedKeyId) {
        return c.json({ error: "keyId is required" }, 400);
      }

      const result = await auth.api.deleteApiKey({
        body: { keyId: resolvedKeyId },
        headers: c.req.raw.headers,
      });
      return c.json({ result });
    } catch (error) {
      logger.error("Failed to delete API key", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to delete API key" }, 500);
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
      logger.error("Failed to list device sessions", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to list device sessions" }, 500);
    }
  });

  /**
   * POST /api/admin/device-sessions/revoke - Revoke a device session
   */
  api.post("/admin/device-sessions/revoke", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { sessionToken } = body as { sessionToken?: string };
      if (!sessionToken) {
        return c.json({ error: "sessionToken is required" }, 400);
      }

      const result = await auth.api.revokeDeviceSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });
      return c.json({ result });
    } catch (error) {
      logger.error("Failed to revoke device session", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to revoke device session" }, 500);
    }
  });

  /**
   * POST /api/admin/device-sessions/activate - Activate a device session
   */
  api.post("/admin/device-sessions/activate", async (c: Context) => {
    try {
      const body = await c.req.json();
      const { sessionToken } = body as { sessionToken?: string };
      if (!sessionToken) {
        return c.json({ error: "sessionToken is required" }, 400);
      }

      const result = await auth.api.setActiveSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });
      return c.json({ session: result });
    } catch (error) {
      logger.error("Failed to set active session", {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.json({ error: "Failed to set active session" }, 500);
    }
  });
}
