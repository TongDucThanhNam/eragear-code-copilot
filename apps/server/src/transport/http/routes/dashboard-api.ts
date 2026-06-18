/**
 * Dashboard API Routes
 *
 * API endpoints for dashboard data and real-time streaming.
 *
 * Endpoints:
 * - GET /api/dashboard/projects - Get projects with session stats
 * - GET /api/dashboard/sessions - Get sessions with details
 * - GET /api/dashboard/stats    - Get overall statistics
 * - GET /api/dashboard/stream   - SSE stream for real-time updates
 * - GET /api/logs               - Get log entries
 * - GET /api/logs/stream        - SSE stream for real-time logs
 *
 * @module transport/http/routes/dashboard-api
 */

import type { Context, Hono } from "hono";
import { matchesLogQuery } from "@/shared/utils/log-query.util";
import { createManagedSseStream } from "../sse-stream";
import {
  parseDashboardSessionPaginationParams,
  parseLogQueryParams,
} from "./dashboard-api-route-input";
import type { HttpRouteDependencies } from "./deps";
import { requireRouteUserId } from "./route-auth";

/**
 * Registers dashboard-related API routes
 */
export function registerDashboardApiRoutes(
  api: Hono,
  deps: Pick<
    HttpRouteDependencies,
    "eventBus" | "logStore" | "useCases" | "appConfig" | "resolveAuthContext"
  >
): void {
  const { eventBus, logStore, useCases, appConfig, resolveAuthContext } = deps;

  const requireUserId = (c: Context) =>
    requireRouteUserId(c, resolveAuthContext);
  const eventVisibilityService = useCases.ops.dashboardEventVisibility;

  // =========================================================================
  // Dashboard Data Endpoints
  // =========================================================================

  /**
   * GET /api/dashboard/projects - Get all projects with session statistics
   */
  api.get("/dashboard/projects", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }
    const service = useCases.ops.dashboardProjects;
    return c.json(await service.execute(auth.userId));
  });

  /**
   * GET /api/dashboard/sessions - Get all sessions with details
   */
  api.get("/dashboard/sessions", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }
    const parsedPagination = parseDashboardSessionPaginationParams(
      c.req.query(),
      appConfig.getConfig().sessionListPageMaxLimit
    );
    if (!parsedPagination.ok) {
      return c.json({ error: parsedPagination.error }, 400);
    }
    const { limit, offset } = parsedPagination.pagination;

    const service = useCases.ops.dashboardSessions;
    return c.json(
      await service.execute({ userId: auth.userId, limit, offset })
    );
  });

  /**
   * GET /api/dashboard/stats - Get dashboard statistics
   */
  api.get("/dashboard/stats", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }
    const service = useCases.ops.dashboardStats;
    return c.json(await service.execute(auth.userId));
  });

  /**
   * GET /api/dashboard/observability - Runtime observability snapshot
   */
  api.get("/dashboard/observability", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }
    const service = useCases.ops.observabilitySnapshot;
    return c.json({ observability: await service.execute(auth.userId) });
  });

  // =========================================================================
  // Log Endpoints
  // =========================================================================

  /**
   * GET /api/logs - Query log entries
   */
  api.get("/logs", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }
    const parsed = parseLogQueryParams(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const result = await logStore.query({
      ...parsed.query,
      userId: auth.userId,
    });
    return c.json({
      ...result,
      now: Date.now(),
    });
  });

  /**
   * GET /api/logs/stream - Real-time log streaming (SSE)
   */
  api.get("/logs/stream", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }
    const parsed = parseLogQueryParams(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const query = {
      ...parsed.query,
      userId: auth.userId,
    };

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = createManagedSseStream({
        signal: c.req.raw.signal,
        start(sender) {
          if (
            !sender.sendEvent(
              "connected",
              {
                ok: true,
                ts: Date.now(),
              },
              { closeOnBackpressure: false }
            )
          ) {
            return undefined;
          }

          return logStore.subscribe((entry) => {
            if (sender.closed || !matchesLogQuery(entry, query)) {
              return;
            }
            sender.sendRaw(`data: ${JSON.stringify(entry)}\n\n`);
          });
        },
        heartbeat(sender) {
          sender.sendRaw(`: ping ${Date.now()}\n\n`);
        },
      });
    } catch {
      return new Response("Failed to initialize event stream", {
        status: 503,
      });
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });

  // =========================================================================
  // Dashboard Stream (SSE)
  // =========================================================================

  /**
   * GET /api/dashboard/stream - Real-time dashboard updates (SSE)
   */
  api.get("/dashboard/stream", async (c: Context) => {
    const auth = await requireUserId(c);
    if (!auth.ok) {
      return auth.response;
    }

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = createManagedSseStream({
        signal: c.req.raw.signal,
        start(sender) {
          if (
            !sender.sendEvent(
              "connected",
              { ok: true, ts: Date.now() },
              { closeOnBackpressure: false }
            )
          ) {
            return undefined;
          }

          return eventBus.subscribe(
            (event) => {
              if (!eventVisibilityService.isVisible(event, auth.userId)) {
                return;
              }
              if (event && typeof event === "object" && "type" in event) {
                const eventType = (event as { type: string }).type;
                sender.sendEvent(eventType, { ts: Date.now(), event });
                return;
              }
              sender.sendEvent("refresh", { ts: Date.now(), event });
            },
            { signal: c.req.raw.signal }
          );
        },
        heartbeat(sender) {
          sender.sendEvent("ping", { ts: Date.now() });
        },
      });
    } catch {
      return new Response("Failed to initialize event stream", {
        status: 503,
      });
    }

    return c.body(stream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  });
}
