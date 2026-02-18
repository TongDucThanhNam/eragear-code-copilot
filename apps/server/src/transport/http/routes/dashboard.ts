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
import { APP_SERVER_TITLE } from "@/config/app-identity";
import { LoginHead, LoginPage } from "@/presentation/dashboard/login";
import { DashboardPage } from "@/presentation/dashboard/server/dashboard-page";
import { renderDocument } from "@/presentation/dashboard/server/render-document";
import { normalizeTab } from "@/presentation/dashboard/utils";
import {
  DASHBOARD_ASSET_PATH,
  DASHBOARD_ASSET_PATH_PREFIX,
  DASHBOARD_UI_PATH,
  LEADING_SLASHES,
  PUBLIC_DASHBOARD_ASSETS_PATH,
} from "../constants";
import type { HttpRouteDependencies } from "./deps";
import { normalizeApiKeyItem, normalizeDeviceSessionItem } from "./helpers";

/**
 * Registers dashboard-related UI routes
 */
export function registerDashboardUiRoutes(
  app: Hono,
  deps: Pick<
    HttpRouteDependencies,
    | "settingsServices"
    | "opsServices"
    | "logger"
    | "auth"
    | "authState"
    | "runtime"
  >
): void {
  const { settingsServices, opsServices, logger, auth, authState, runtime } =
    deps;
  // Static assets (long-term cache)
  const assetCacheControl = runtime.isDev
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
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) {
      return c.redirect(DASHBOARD_UI_PATH);
    }
    const username = authState.adminUsername ?? runtime.defaultAdminUsername;
    return renderDocument(c, createElement(LoginPage, { username }), {
      title: `${APP_SERVER_TITLE} Login`,
      head: createElement(LoginHead, { username }),
      bodyClassName:
        "flex min-h-screen flex-col bg-[#F9F9F7] font-body text-[#111111] antialiased",
    });
  });

  // Dashboard UI (protected)
  app.get(DASHBOARD_UI_PATH, async (c: Context) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id) {
      return c.redirect("/login");
    }
    const getSettings = settingsServices.getSettings();
    const dashboardPageData = opsServices.dashboardPageData();
    const [settings, baseDashboardData] = await Promise.all([
      getSettings.execute(),
      dashboardPageData.execute({ userId: session.user.id }),
    ]);

    let apiKeys: unknown[] = [];
    let deviceSessions: unknown[] = [];

    try {
      const listed = await auth.api.listApiKeys({ headers: c.req.raw.headers });
      apiKeys = Array.isArray(listed) ? listed : [];
    } catch (error) {
      logger.error("Failed to load API keys for dashboard", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const listed = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });
      deviceSessions = Array.isArray(listed) ? listed : [];
    } catch (error) {
      logger.error("Failed to load device sessions for dashboard", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const normalizedApiKeys = apiKeys.map((item: unknown) =>
      normalizeApiKeyItem(item as never)
    );
    const normalizedDeviceSessions = deviceSessions.map((item: unknown) =>
      normalizeDeviceSessionItem(item as never)
    );

    const dashboardData = {
      ...baseDashboardData,
      apiKeys: normalizedApiKeys,
      deviceSessions: normalizedDeviceSessions,
    };

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
        title: `${APP_SERVER_TITLE} Dashboard`,
        bodyClassName: "bg-paper font-body text-ink antialiased",
        bodyAttributes: { "data-active-tab": normalizedTab },
      }
    );
  });
}
