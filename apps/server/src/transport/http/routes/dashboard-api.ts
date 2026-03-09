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

function enqueueSseChunk(params: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  payload: string;
  closed: boolean;
  close: () => void;
  closeOnBackpressure?: boolean;
}): boolean {
  if (params.closed) {
    return false;
  }
  if (
    params.closeOnBackpressure &&
    params.controller.desiredSize !== null &&
    params.controller.desiredSize <= 0
  ) {
    // Fail fast on slow consumers so SSE buffers cannot grow without bound.
    params.close();
    return false;
  }
  try {
    params.controller.enqueue(params.encoder.encode(params.payload));
    return true;
  } catch {
    params.close();
    return false;
  }
}

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
  const requireUserId = async (c: Context): Promise<string | Response> => {
    const userId = await resolveUserId(c);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return userId;
  };
  const eventVisibilityService = opsServices.dashboardEventVisibility();

  // =========================================================================
  // Dashboard Data Endpoints
  // =========================================================================

  /**
   * GET /api/dashboard/projects - Get all projects with session statistics
   */
  api.get("/dashboard/projects", async (c: Context) => {
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
    }
    const service = opsServices.dashboardProjects();
    return c.json(await service.execute(userId));
  });

  /**
   * GET /api/dashboard/sessions - Get all sessions with details
   */
  api.get("/dashboard/sessions", async (c: Context) => {
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
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
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
    }
    const service = opsServices.dashboardStats();
    return c.json(await service.execute(userId));
  });

  /**
   * GET /api/dashboard/observability - Runtime observability snapshot
   */
  api.get("/dashboard/observability", async (c: Context) => {
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
    }
    const service = opsServices.observabilitySnapshot();
    return c.json({ observability: await service.execute(userId) });
  });

  // =========================================================================
  // Log Endpoints
  // =========================================================================

  /**
   * GET /api/logs - Query log entries
   */
  api.get("/logs", async (c: Context) => {
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
    }
    const parsed = parseLogQueryParams(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const result = await logStore.query({
      ...parsed.query,
      userId,
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
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
    }
    const parsed = parseLogQueryParams(c.req.query());
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    const query = {
      ...parsed.query,
      userId,
    };
    const encoder = new TextEncoder();
    const abortSignal = c.req.raw.signal;

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
      abortSignal?.removeEventListener("abort", close);
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (controllerRef) {
        try {
          controllerRef.close();
        } catch {
          // The stream may already be closed or canceled.
        }
        controllerRef = null;
      }
    };

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          if (abortSignal?.aborted) {
            close();
            return;
          }
          const send = (payload: string) => {
            return enqueueSseChunk({
              controller,
              encoder,
              payload,
              closed,
              close,
              closeOnBackpressure: !payload.startsWith("event: connected"),
            });
          };

          if (
            !send(
              `event: connected\ndata: ${JSON.stringify({
                ok: true,
                ts: Date.now(),
              })}\n\n`
            )
          ) {
            return;
          }

          unsubscribe = logStore.subscribe((entry) => {
            if (closed) {
              return;
            }
            if (!matchesLogQuery(entry, query)) {
              return;
            }
            send(`data: ${JSON.stringify(entry)}\n\n`);
          });
          if (closed && unsubscribe) {
            unsubscribe();
            unsubscribe = null;
            return;
          }

          heartbeat = setInterval(() => {
            send(`: ping ${Date.now()}\n\n`);
          }, 15_000);
          heartbeat.unref?.();

          abortSignal?.addEventListener("abort", close, { once: true });
        },
        cancel() {
          close();
        },
      });
    } catch {
      close();
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
    const userId = await requireUserId(c);
    if (userId instanceof Response) {
      return userId;
    }
    const encoder = new TextEncoder();
    const abortSignal = c.req.raw.signal;

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
      abortSignal?.removeEventListener("abort", close);
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (controllerRef) {
        try {
          controllerRef.close();
        } catch {
          // The stream may already be closed or canceled.
        }
        controllerRef = null;
      }
    };

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = new ReadableStream({
        start(controller) {
          controllerRef = controller;
          if (abortSignal?.aborted) {
            close();
            return;
          }
          const send = (event: string, data: unknown) => {
            return enqueueSseChunk({
              controller,
              encoder,
              payload: `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              closed,
              close,
              closeOnBackpressure: event !== "connected",
            });
          };

          if (!send("connected", { ok: true, ts: Date.now() })) {
            return;
          }

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
          if (closed && unsubscribe) {
            unsubscribe();
            unsubscribe = null;
            return;
          }

          heartbeat = setInterval(() => {
            send("ping", { ts: Date.now() });
          }, 15_000);
          heartbeat.unref?.();

          abortSignal?.addEventListener("abort", close, { once: true });
        },
        cancel() {
          close();
        },
      });
    } catch {
      close();
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
