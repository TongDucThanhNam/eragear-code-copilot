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

import { file as bunFile } from "bun";
import type { Context, Hono } from "hono";
import { createElement } from "react";
import { APP_SERVER_TITLE } from "@/config/app-identity";
import { LoginHead, LoginPage } from "@/presentation/dashboard/login";
import {
  getDashboardAsset,
  getDashboardAssetVersion,
} from "@/presentation/dashboard/server/dashboard-assets";
import { DashboardPage } from "@/presentation/dashboard/server/dashboard-page";
import { renderDocument } from "@/presentation/dashboard/server/render-document";
import { DASHBOARD_ASSET_PATH, DASHBOARD_UI_PATH } from "../constants";
import {
  normalizeApiKeyItem,
  normalizeDeviceSessionItem,
} from "./auth-management-data";
import {
  createDashboardAssetRouteHeaders,
  parseDashboardAssetRouteRequest,
} from "./dashboard-asset-route-input";
import { parseDashboardPageRouteState } from "./dashboard-page-route-input";
import { createDashboardLegacyRedirectLocation } from "./dashboard-redirect-route-input";
import type { HttpRouteDependencies } from "./deps";

/**
 * Registers dashboard-related UI routes
 */
export function registerDashboardUiRoutes(
  app: Hono,
  deps: Pick<
    HttpRouteDependencies,
    "useCases" | "logger" | "auth" | "authState" | "runtime"
  >
): void {
  const { useCases, logger, auth, authState, runtime } = deps;

  app.get(`${DASHBOARD_ASSET_PATH}/*`, (c) => {
    const parsedAsset = parseDashboardAssetRouteRequest(c.req.path);
    if (!parsedAsset.ok) {
      return c.json({ error: parsedAsset.error }, 404);
    }
    const { assetName } = parsedAsset.input;
    const asset = getDashboardAsset(assetName);
    if (!asset) {
      return c.json({ error: "Not found" }, 404);
    }
    return new Response(bunFile(asset.path), {
      headers: createDashboardAssetRouteHeaders({
        assetName,
        assetVersion: getDashboardAssetVersion(),
        contentType: asset.contentType,
        isDev: runtime.isDev,
      }),
    });
  });

  // Legacy redirects
  const redirectWithQuery = (c: Context) => {
    return c.redirect(createDashboardLegacyRedirectLocation(c.req.raw.url));
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
        "flex h-dvh min-h-screen w-full flex-col overflow-hidden bg-[#F9F9F7] font-body text-[#111111] antialiased",
    });
  });

  // Dashboard UI (protected)
  app.get(DASHBOARD_UI_PATH, async (c: Context) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user?.id) {
      return c.redirect("/login");
    }
    const getSettings = useCases.settings.get;
    const dashboardPageData = useCases.ops.dashboardPageData;
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

    const pageState = parseDashboardPageRouteState(c.req.query());

    return renderDocument(
      c,
      createElement(DashboardPage, {
        settings,
        dashboardData,
        activeTab: pageState.activeTab,
        success: pageState.success,
        notice: pageState.notice,
        errors: pageState.errors,
        requiresRestart: pageState.requiresRestart,
      }),
      {
        title: `${APP_SERVER_TITLE} Dashboard`,
        bodyClassName: "bg-paper font-body text-ink antialiased",
        bodyAttributes: { "data-active-tab": pageState.activeTab },
      }
    );
  });
}
