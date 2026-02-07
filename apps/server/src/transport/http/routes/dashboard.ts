/**
 * Dashboard UI Routes
 *
 * HTML routes + static assets for the internal server dashboard.
 *
 * Endpoints:
 * - GET /_/dashboard          - Dashboard UI (protected)
 * - GET /dashboard            - Legacy redirect to /_/dashboard
 * - GET /                    - Legacy redirect to /_/dashboard
 * - GET /login               - Login page
 * - GET /_/dashboard/assets/* - Dashboard static assets
 *
 * @module transport/http/routes/dashboard
 */

import type { Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createElement } from "react";
import { LoginHead, LoginPage } from "@/presentation/dashboard/login";
import { buildDashboardData } from "@/presentation/dashboard/server/build-dashboard-data";
import { DashboardPage } from "@/presentation/dashboard/server/dashboard-page";
import { renderDocument } from "@/presentation/dashboard/server/render-document";
import { normalizeTab } from "@/presentation/dashboard/utils";
import { getContainer } from "../../../bootstrap/container";
import { DEFAULT_SESSION_LIST_PAGE_LIMIT } from "../../../config/constants";
import { ENV } from "../../../config/environment";
import {
  DASHBOARD_ASSET_PATH,
  DASHBOARD_ASSET_PATH_PREFIX,
  DASHBOARD_UI_PATH,
  LEADING_SLASHES,
  PUBLIC_DASHBOARD_ASSETS_PATH,
} from "../constants";
import {
  getSessionFromRequest,
  listApiKeys,
  listDeviceSessions,
  resolveAdminUsername,
} from "../utils/auth";
import { normalizeApiKeyItem, normalizeDeviceSessionItem } from "./helpers";

/**
 * Registers dashboard-related UI routes
 */
export function registerDashboardUiRoutes(app: Hono): void {
  // Static assets (long-term cache)
  const assetCacheControl = ENV.isDev
    ? "no-cache"
    : "public, max-age=31536000, immutable";

  app.use(`${DASHBOARD_ASSET_PATH}/*`, (c, next) => {
    c.res.headers.set("Cache-Control", assetCacheControl);
    return next();
  });

  app.use(
    `${DASHBOARD_ASSET_PATH}/*`,
    serveStatic({
      root: PUBLIC_DASHBOARD_ASSETS_PATH,
      rewriteRequestPath: (path) =>
        path
          .replace(DASHBOARD_ASSET_PATH_PREFIX, "")
          .replace(LEADING_SLASHES, ""),
    })
  );

  // Legacy redirects
  const redirectWithQuery = (c: Context) => {
    const requestUrl = c.req.raw.url ?? "";
    const queryIndex = requestUrl.indexOf("?");
    const query =
      queryIndex === -1 ? "" : requestUrl.slice(queryIndex + 1).trim();
    return c.redirect(
      query ? `${DASHBOARD_UI_PATH}?${query}` : DASHBOARD_UI_PATH
    );
  };
  app.get("/", redirectWithQuery);
  app.get("/dashboard", redirectWithQuery);

  // Login page
  app.get("/login", async (c: Context) => {
    const session = await getSessionFromRequest({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (session) {
      return c.redirect(DASHBOARD_UI_PATH);
    }
    const username = resolveAdminUsername(ENV.authAdminUsername ?? "admin");
    return renderDocument(c, createElement(LoginPage, { username }), {
      title: "Eragear Server Login",
      head: createElement(LoginHead, { username }),
      bodyClassName:
        "flex min-h-screen flex-col bg-[#F9F9F7] font-body text-[#111111] antialiased",
    });
  });

  // Dashboard UI (protected)
  app.get(DASHBOARD_UI_PATH, async (c: Context) => {
    const session = await getSessionFromRequest({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!session) {
      return c.redirect("/login");
    }
    const container = getContainer();
    const settings = await container.getSettings().get();
    const projects = await container.getProjects().findAll();
    const storedSessions = await container.getSessions().findAll({
      limit: DEFAULT_SESSION_LIST_PAGE_LIMIT,
      offset: 0,
    });
    const runtimeSessions = container.getSessionRuntime();
    const agents = await container.getAgents().findAll();

    let apiKeys: unknown[] = [];
    let deviceSessions: unknown[] = [];

    try {
      apiKeys = await listApiKeys(c.req.raw.headers);
    } catch (error) {
      console.error("[Server] Failed to load API keys", error);
    }

    try {
      deviceSessions = await listDeviceSessions(c.req.raw.headers);
    } catch (error) {
      console.error("[Server] Failed to load device sessions", error);
    }

    const normalizedApiKeys = apiKeys.map((item: unknown) =>
      normalizeApiKeyItem(item as never)
    );
    const normalizedDeviceSessions = deviceSessions.map((item: unknown) =>
      normalizeDeviceSessionItem(item as never)
    );

    const dashboardData = buildDashboardData({
      projects,
      sessions: storedSessions,
      runtimeSessions,
      agents,
      apiKeys: normalizedApiKeys,
      deviceSessions: normalizedDeviceSessions,
    });

    const { tab, success, error, notice, restart } = c.req.query();
    const normalizedTab = normalizeTab(tab);
    const requiresRestart = restart
      ? restart
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;

    return renderDocument(
      c,
      createElement(DashboardPage, {
        settings,
        dashboardData,
        activeTab: normalizedTab,
        success: success === "1",
        notice: notice || undefined,
        errors: error ? { general: error } : undefined,
        requiresRestart,
      }),
      {
        title: "Eragear Server Dashboard",
        bodyClassName: "bg-paper font-body text-ink antialiased",
        bodyAttributes: { "data-active-tab": normalizedTab },
      }
    );
  });
}
