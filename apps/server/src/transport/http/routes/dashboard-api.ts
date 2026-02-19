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
import type { HttpRouteDependencies } from "./deps";
import { parseLogQueryParams, parseSessionPaginationParams } from "./helpers";

/**
 * Registers dashboard-related API routes
 */
export function registerDashboardApiRoutes(
  api: Hono,
  deps: Pick<
    HttpRouteDependencies,
    "eventBus" | "logStore" | "opsServices" | "appConfig" | "resolveAuthContext"
  >
): void {
  const { eventBus, logStore, opsServices, appConfig, resolveAuthContext } =
    deps;

  const resolveUserId = async (c: Context): Promise<string | null> => {
    const auth = await resolveAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
      remoteAddress: c.req.header("x-eragear-remote-address"),
    });
    return auth?.userId ?? null;
  };
  const eventVisibilityService = opsServices.dashboardEventVisibility();

  // =========================================================================
  // Dashboard Data Endpoints
  // =========================================================================

  /**
   * GET /api/dashboard/projects - Get all projects with session statistics
   */
  api.get("/dashboard/projects", async (c: Context) => {
    const userId = await resolveUserId(c);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const service = opsServices.dashboardProjects();
    return c.json(await service.execute(userId));
  });

  /**
   * GET /api/dashboard/sessions - Get all sessions with details
   */
  api.get("/dashboard/sessions", async (c: Context) => {
    const userId = await resolveUserId(c);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const parsedPagination = parseSessionPaginationParams(
      c.req.query(),
      appConfig.getConfig().sessionListPageMaxLimit
    );
    if (!parsedPagination.ok) {
      return c.json({ error: parsedPagination.error }, 400);
    }
    const { limit, offset } = parsedPagination.pagination;

    const service = opsServices.dashboardSessions();
    return c.json(await service.execute({ userId, limit, offset }));
  });

  /**
   * GET /api/dashboard/stats - Get dashboard statistics
   */
  api.get("/dashboard/stats", async (c: Context) => {
    const userId = await resolveUserId(c);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const service = opsServices.dashboardStats();
    return c.json(await service.execute(userId));
  });

  /**
   * GET /api/dashboard/observability - Runtime observability snapshot
   */
  api.get("/dashboard/observability", (c: Context) => {
    const service = opsServices.observabilitySnapshot();
    return c.json({ observability: service.execute() });
  });

  // =========================================================================
  // Log Endpoints
  // =========================================================================

  /**
   * GET /api/logs - Query log entries
   */
  api.get("/logs", (c: Context) => {
    const parsed = parseLogQueryParams(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    return c.json(logStore.list(parsed.query));
  });

  /**
   * GET /api/logs/stream - Real-time log streaming (SSE)
   */
  api.get("/logs/stream", (c: Context) => {
    const parsed = parseLogQueryParams(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const query = parsed.query;
    const encoder = new TextEncoder();

    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null =
      null;

    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (unsubscribe) {
        unsubscribe();
      }
      if (controllerRef) {
        controllerRef.close();
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        const send = (payload: string) => {
          controller.enqueue(encoder.encode(payload));
        };

        send(
          `event: connected\ndata: ${JSON.stringify({
            ok: true,
            ts: Date.now(),
          })}\n\n`
        );

        unsubscribe = logStore.subscribe((entry) => {
          if (closed) {
            return;
          }
          if (!matchesLogQuery(entry, query)) {
            return;
          }
          send(`data: ${JSON.stringify(entry)}\n\n`);
        });

        heartbeat = setInterval(() => {
          send(`: ping ${Date.now()}\n\n`);
        }, 15_000);

        c.req.raw.signal?.addEventListener("abort", close);
      },
      cancel() {
        close();
      },
    });

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
    const userId = await resolveUserId(c);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const encoder = new TextEncoder();

    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        send("connected", { ok: true, ts: Date.now() });

        unsubscribe = eventBus.subscribe(
          (event) => {
            if (!eventVisibilityService.isVisible(event, userId)) {
              return;
            }
            if (event && typeof event === "object" && "type" in event) {
              const eventType = (event as { type: string }).type;
              send(eventType, { ts: Date.now(), event });
              return;
            }
            send("refresh", { ts: Date.now(), event });
          },
          { signal: c.req.raw.signal }
        );

        heartbeat = setInterval(() => {
          send("ping", { ts: Date.now() });
        }, 15_000);

        c.req.raw.signal?.addEventListener("abort", () => {
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        });
      },
      cancel() {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      },
    });

    return c.body(stream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  });
}
