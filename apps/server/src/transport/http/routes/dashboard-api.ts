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
import { getContainer } from "../../../bootstrap/container";
import type { Project } from "../../../shared/types/project.types";
import type { StoredSession } from "../../../shared/types/session.types";
import { parseLogQueryParams } from "./helpers";

/**
 * Registers dashboard-related API routes
 */
export function registerDashboardApiRoutes(api: Hono): void {
  const container = getContainer();

  // =========================================================================
  // Dashboard Data Endpoints
  // =========================================================================

  /**
   * GET /api/dashboard/projects - Get all projects with session statistics
   */
  api.get("/dashboard/projects", (c: Context) => {
    const projects = container.getProjects().findAll();
    const sessions = container.getSessions().findAll();

    const projectsWithStats = projects.map((project: Project) => {
      const projectSessions = sessions.filter(
        (s: StoredSession) =>
          s.projectId === project.id || s.projectRoot === project.path
      );
      const runningSessions = projectSessions.filter(
        (s: StoredSession) => s.status === "running"
      );
      return {
        ...project,
        sessionCount: projectSessions.length,
        runningCount: runningSessions.length,
        lastOpenedAt: project.lastOpenedAt,
      };
    });

    return c.json({ projects: projectsWithStats });
  });

  /**
   * GET /api/dashboard/sessions - Get all sessions with details
   */
  api.get("/dashboard/sessions", (c: Context) => {
    const projects = container.getProjects().findAll();
    const storedSessions = container.getSessions().findAll();
    const runtime = container.getSessionRuntime();

    const sessions = storedSessions.map((session: StoredSession) => {
      const activeSession = runtime.get(session.id);
      const isActive = Boolean(activeSession);
      const agentInfo = activeSession?.agentInfo ?? session.agentInfo;
      const agentName = agentInfo?.title ?? agentInfo?.name ?? "Unknown Agent";

      return {
        id: session.id,
        sessionId: session.sessionId,
        projectId: session.projectId ?? null,
        projectRoot: session.projectRoot,
        projectName: session.projectId
          ? projects.find((p) => p.id === session.projectId)?.name
          : session.projectRoot.split("/").pop(),
        modeId: session.modeId,
        status: session.status,
        isActive,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        agentInfo,
        agentName,
        messageCount: session.messages?.length ?? 0,
      };
    });

    const sortedSessions = [...sessions];
    sortedSessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return c.json({ sessions: sortedSessions });
  });

  /**
   * GET /api/dashboard/stats - Get dashboard statistics
   */
  api.get("/dashboard/stats", (c: Context) => {
    const projects = container.getProjects().findAll();
    const sessions = container.getSessions().findAll();

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const recentSessions = sessions.filter(
      (s: StoredSession) => s.lastActiveAt > oneDayAgo
    );
    const weeklySessions = sessions.filter(
      (s: StoredSession) => s.lastActiveAt > oneWeekAgo
    );
    const runningSessions = sessions.filter(
      (s: StoredSession) => s.status === "running"
    );

    const agentStats: Record<string, { count: number; running: number }> = {};
    for (const session of sessions) {
      const agentName =
        session.agentInfo?.title ?? session.agentInfo?.name ?? "Unknown";
      if (!agentStats[agentName]) {
        agentStats[agentName] = { count: 0, running: 0 };
      }
      agentStats[agentName].count++;
      if (session.status === "running") {
        agentStats[agentName].running++;
      }
    }

    return c.json({
      stats: {
        totalProjects: projects.length,
        totalSessions: sessions.length,
        activeSessions: runningSessions.length,
        recentSessions24h: recentSessions.length,
        weeklySessions: weeklySessions.length,
        agentStats,
        serverUptime: process.uptime(),
      },
    });
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
    const logStore = container.getLogStore();
    return c.json(logStore.list(parsed.query));
  });

  /**
   * GET /api/logs/stream - Real-time log streaming (SSE)
   */
  api.get("/logs/stream", (c: Context) => {
    const logStore = container.getLogStore();
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
  api.get("/dashboard/stream", (c: Context) => {
    const eventBus = container.getEventBus();
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

        unsubscribe = eventBus.subscribe((event) => {
          if (event && typeof event === "object" && "type" in event) {
            const eventType = (event as { type: string }).type;
            send(eventType, { ts: Date.now(), event });
            return;
          }
          send("refresh", { ts: Date.now(), event });
        });

        heartbeat = setInterval(() => {
          send("ping", { ts: Date.now() });
        }, 15_000);
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
