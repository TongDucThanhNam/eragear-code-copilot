/**
 * Admin Routes
 *
 * API and form endpoints for admin operations (API keys, device sessions).
 *
 * Endpoints:
 * - GET    /api/admin/api-keys                   - List API keys
 * - POST   /api/admin/api-keys                   - Create API key
 * - DELETE /api/admin/api-keys                   - Delete API key
 * - GET    /api/admin/device-sessions            - List device sessions
 * - POST   /api/admin/device-sessions/revoke     - Revoke device session
 * - POST   /api/admin/device-sessions/activate   - Activate device session
 * - POST   /form/admin/api-keys/create           - Create API key (HTML form)
 * - POST   /form/admin/api-keys/delete           - Delete API key (HTML form)
 * - POST   /form/admin/device-sessions/revoke    - Revoke session (HTML form)
 * - POST   /form/admin/device-sessions/activate  - Activate session (HTML form)
 *
 * @module transport/http/routes/admin
 */

import type { Context, Hono } from "hono";
import { createElement } from "react";
import { getContainer } from "../../../bootstrap/container";
import { buildDashboardData } from "../ui/dashboard-data";
import { ConfigPage } from "../ui/dashboard-view";
import { renderDocument } from "../ui/render-document";
import { getSessionFromRequest } from "../utils/auth";
import {
  type FormDataRecord,
  getFormValue,
  normalizeApiKeyCreateResponse,
  normalizeApiKeyItem,
  normalizeDeviceSessionItem,
  redirectWithParams,
} from "./helpers";

/**
 * Registers admin-related HTTP routes
 */
export function registerAdminRoutes(api: Hono, form: Hono): void {
  const container = getContainer();
  const auth = container.getAuth();

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
      return c.json({ keys });
    } catch (error) {
      console.error("Failed to list API keys:", error);
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

      const apiKey = await auth.api.createApiKey({
        body: {
          name,
          prefix,
          expiresIn,
          userId: session.user.id,
        },
      });

      return c.json({ apiKey });
    } catch (error) {
      console.error("Failed to create API key:", error);
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
      console.error("Failed to delete API key:", error);
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
      return c.json({ sessions });
    } catch (error) {
      console.error("Failed to list device sessions:", error);
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
      console.error("Failed to revoke device session:", error);
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
      console.error("Failed to set active session:", error);
      return c.json({ error: "Failed to set active session" }, 500);
    }
  });

  // =========================================================================
  // Form Routes (HTML form submissions)
  // =========================================================================

  /**
   * POST /form/admin/api-keys/create - Create API key via HTML form
   */
  form.post("/admin/api-keys/create", async (c: Context) => {
    try {
      const session = await getSessionFromRequest({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
      });
      if (!session) {
        return c.redirect("/login");
      }

      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const name = getFormValue(formData, "name").trim();
      const prefix = getFormValue(formData, "prefix").trim();
      const expiresInDays = Number(
        getFormValue(formData, "expiresInDays") || 0
      );
      const expiresIn =
        Number.isFinite(expiresInDays) && expiresInDays > 0
          ? Math.round(expiresInDays * 86_400)
          : undefined;

      const created = normalizeApiKeyCreateResponse(
        (await auth.api.createApiKey({
          body: {
            name: name || undefined,
            prefix: prefix || undefined,
            expiresIn,
            userId: session.user.id,
          },
        })) as {
          id: string;
          key: string;
          name: string | null;
          prefix: string | null;
          start: string | null;
          createdAt: string | Date;
        }
      );

      const apiKeys = await auth.api.listApiKeys({
        headers: c.req.raw.headers,
      });
      const deviceSessions = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });

      const dashboardData = buildDashboardData({
        projects: container.getProjects().findAll(),
        sessions: container.getSessions().findAll(),
        runtimeSessions: container.getSessionRuntime(),
        agents: container.getAgents().findAll(),
        apiKeys: Array.isArray(apiKeys) ? apiKeys.map(normalizeApiKeyItem) : [],
        deviceSessions: Array.isArray(deviceSessions)
          ? deviceSessions.map(normalizeDeviceSessionItem)
          : [],
      });

      const activeTab = "auth";
      return renderDocument(
        c,
        createElement(ConfigPage, {
          settings: container.getSettings().get(),
          dashboardData,
          activeTab,
          notice: "API key created.",
          createdApiKey: created,
        }),
        {
          title: "Eragear Server Dashboard",
          bodyClassName: "bg-paper font-body text-ink antialiased",
          bodyAttributes: { "data-active-tab": activeTab },
        }
      );
    } catch (error) {
      console.error("Failed to create API key:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to create API key",
      });
    }
  });

  /**
   * POST /form/admin/api-keys/delete - Delete API key via HTML form
   */
  form.post("/admin/api-keys/delete", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const keyId = getFormValue(formData, "keyId");
      if (!keyId) {
        return redirectWithParams(c, {
          tab: "auth",
          error: "keyId is required",
        });
      }

      await auth.api.deleteApiKey({
        body: { keyId },
        headers: c.req.raw.headers,
      });

      return redirectWithParams(c, {
        tab: "auth",
        notice: "API key revoked.",
      });
    } catch (error) {
      console.error("Failed to delete API key:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to revoke API key",
      });
    }
  });

  /**
   * POST /form/admin/device-sessions/revoke - Revoke device session via HTML form
   */
  form.post("/admin/device-sessions/revoke", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const sessionToken = getFormValue(formData, "sessionToken");
      if (!sessionToken) {
        return redirectWithParams(c, {
          tab: "auth",
          error: "sessionToken is required",
        });
      }

      await auth.api.revokeDeviceSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });

      return redirectWithParams(c, {
        tab: "auth",
        notice: "Device session revoked.",
      });
    } catch (error) {
      console.error("Failed to revoke device session:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to revoke device session",
      });
    }
  });

  /**
   * POST /form/admin/device-sessions/activate - Activate device session via HTML form
   */
  form.post("/admin/device-sessions/activate", async (c: Context) => {
    try {
      const body = await c.req.parseBody();
      const formData = body as FormDataRecord;
      const sessionToken = getFormValue(formData, "sessionToken");
      if (!sessionToken) {
        return redirectWithParams(c, {
          tab: "auth",
          error: "sessionToken is required",
        });
      }

      await auth.api.setActiveSession({
        body: { sessionToken },
        headers: c.req.raw.headers,
      });

      return redirectWithParams(c, {
        tab: "auth",
        notice: "Device session activated.",
      });
    } catch (error) {
      console.error("Failed to set active session:", error);
      return redirectWithParams(c, {
        tab: "auth",
        error: "Failed to activate device session",
      });
    }
  });
}
