/**
 * Server Bootstrap Module
 *
 * Initializes and starts the HTTP and WebSocket servers.
 * Sets up the Hono web framework, tRPC router, and WebSocket handler for
 * real-time communication with the ACP client.
 *
 * @module bootstrap/server
 */

import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { reactRenderer } from "@hono/react-renderer";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createElement, Fragment } from "react";
import { WebSocketServer } from "ws";
import { ENV } from "../config/environment";
import { ReconcileSessionStatusService } from "../modules/session";
import { auth, authConfig, authState } from "../platform/auth/auth";
import { ensureAuthSetup } from "../platform/auth/bootstrap";
import { getAuthContext } from "../platform/auth/guards";
import {
  BackgroundRunner,
  createCachePruneTask,
  createSessionIdleCleanupTask,
  createSqliteStorageMaintenanceTask,
} from "../platform/background";
import { installConsoleLogger } from "../platform/logging/logger";
import { createRequestLogger } from "../platform/logging/request-logger";
import { createLogger } from "../platform/logging/structured-logger";
import { closeSqliteStorage } from "../platform/storage/sqlite-db";
import { runSqliteRuntimeMaintenance } from "../platform/storage/sqlite-store";
import { terminateSessionTerminals } from "../shared/utils/session-cleanup.util";
import { createCorsMiddlewares } from "../transport/http/cors-factory";
import { createErrorHandler } from "../transport/http/error-handler";
import { requestIdMiddleware } from "../transport/http/request-id";
import { registerHttpRoutes } from "../transport/http/routes";
import { registerDashboardUiRoutes } from "../transport/http/routes/dashboard";
import { applyFetchHeadersToNodeResponse } from "../transport/http/utils/response-headers";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import { getContainer, initializeContainerFromSettings } from "./container";

const logger = createLogger("Server");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHUTDOWN_COMPACTION_MAX_BUDGET_MS = 5000;

async function pipeResponseBody(
  res: ServerResponse,
  response: Response
): Promise<void> {
  const body = response.body;
  if (!body) {
    res.end();
    return;
  }

  const fromWeb = (
    Readable as typeof Readable & {
      fromWeb?: (stream: ReadableStream) => NodeJS.ReadableStream;
    }
  ).fromWeb;

  if (typeof fromWeb === "function") {
    fromWeb(body as unknown as ReadableStream).pipe(res);
    return;
  }

  // Fallback: manual chunk reading (for older Node versions)
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        const chunk = Buffer.from(value);
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    }
  } finally {
    res.end();
  }
}

/**
 * Creates the Hono application with all middleware and routes
 *
 * @returns Configured Hono application instance
 */
export async function createApp() {
  // Initialize DI container with allowed roots from settings
  const container = await initializeContainerFromSettings();
  await new ReconcileSessionStatusService(
    container.getSessions(),
    container.getSessionRuntime()
  ).execute();

  const app = new Hono();
  app.use(
    "*",
    reactRenderer(({ children }) => createElement(Fragment, null, children))
  );
  app.use(requestIdMiddleware());
  app.use(createRequestLogger());

  // Response timing middleware for performance monitoring
  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    c.res.headers.set("X-Response-Time", `${duration}ms`);
  });

  // Compression middleware - reduce response size by 60-70%
  if (typeof globalThis.CompressionStream === "function") {
    app.use(compress());
  } else {
    logger.warn("Compression disabled: CompressionStream is not available");
  }

  // Create reusable CORS middleware factory
  const corsMiddleware = createCorsMiddlewares(
    authConfig.trustedOrigins,
    ENV.corsStrictOrigin
  );

  // Apply API CORS defaults (auth/health override below)
  app.use("/api/*", corsMiddleware.api);

  // Auth CORS
  app.use("/api/auth/*", corsMiddleware.auth);

  app.use("/api/health", corsMiddleware.health);

  app.all("/api/auth/*", async (c) => {
    const path = c.req.path;
    const isSignup = path.startsWith("/api/auth/sign-up");
    const isUsernameAvailability = path.startsWith(
      "/api/auth/is-username-available"
    );

    if (path === "/api/auth/api-key/verify" && c.req.method === "POST") {
      try {
        const body = await c.req.json();
        const result = await auth.api.verifyApiKey({
          body,
        });
        return c.json(result);
      } catch (error) {
        logger.error("Failed to verify API key", error as Error);
        return c.json(
          {
            valid: false,
            error: { message: "Invalid API key", code: "INVALID_API_KEY" },
          },
          401
        );
      }
    }

    if (
      !ENV.authAllowSignup &&
      authState.hasUsers &&
      (isSignup || isUsernameAvailability)
    ) {
      return c.json({ error: "Sign-up is disabled" }, 403);
    }

    return await auth.handler(c.req.raw);
  });

  app.get("/api/health", (c) => {
    return c.json({ ok: true, ts: Date.now() });
  });

  // Protect API routes (except /api/auth)
  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth") ||
      c.req.path.startsWith("/api/health")
    ) {
      return next();
    }
    const authContext = await getAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!authContext) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  // Register HTTP routes
  const api = new Hono();
  registerHttpRoutes(api);
  app.route("/api", api);
  registerDashboardUiRoutes(app);

  // Explicit 404 handler for better UX
  app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

  // Error handler for unhandled exceptions
  app.onError(createErrorHandler());

  return app;
}

/**
 * Starts the server with HTTP and WebSocket support
 *
 * @returns Promise resolving to server objects
 */
export async function startServer() {
  installConsoleLogger();
  await ensureAuthSetup();
  const app = await createApp();
  const container = getContainer();
  const backgroundRunner = new BackgroundRunner();
  backgroundRunner.register(
    createSessionIdleCleanupTask({
      sessionRuntime: container.getSessionRuntime(),
      sessionRepo: container.getSessions(),
    })
  );
  backgroundRunner.register(
    createSqliteStorageMaintenanceTask({
      sessionRepo: container.getSessions(),
      sessionRuntime: container.getSessionRuntime(),
    })
  );
  backgroundRunner.register(createCachePruneTask());
  container.setBackgroundRunnerStateProvider(() => backgroundRunner.getState());
  backgroundRunner.start();

  const server = createServer(async (req, res) => {
    const host = req.headers.host ?? `${ENV.wsHost}:${ENV.wsPort}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(","));
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }
    const requestInit: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers,
      body:
        req.method && req.method !== "GET" && req.method !== "HEAD"
          ? (req as unknown as BodyInit)
          : undefined,
      duplex: "half",
    };
    const request = new Request(url, requestInit);

    const response = await app.fetch(request);
    res.statusCode = response.status;
    applyFetchHeadersToNodeResponse(res, response.headers);

    if (req.method === "HEAD" || response.status === 204) {
      res.end();
      return;
    }

    await pipeResponseBody(res, response);
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: ENV.wsMaxPayloadBytes,
  });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const wsHandler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: ({ req }) =>
      createTrpcContext({
        req,
      }),
  });

  server.listen(ENV.wsPort, ENV.wsHost);

  logger.info("HTTP + WebSocket server started", {
    host: ENV.wsHost,
    port: ENV.wsPort,
  });

  let shuttingDown = false;
  const gracefulShutdown = async (signal: "SIGTERM" | "SIGINT") => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`${signal} received, gracefully shutting down`);
    backgroundRunner.stop();
    wsHandler.broadcastReconnectNotification();

    const sessionRuntime = container.getSessionRuntime();
    const sessionRepo = container.getSessions();
    for (const session of sessionRuntime.getAll()) {
      terminateSessionTerminals(session);
      if (!session.proc.killed) {
        session.proc.kill("SIGTERM");
      }
      sessionRuntime.delete(session.id);
      await sessionRepo.updateStatus(session.id, "stopped");
    }

    const compactBeforeTs =
      Date.now() - Math.max(1, ENV.sqliteRetentionHotDays) * MS_PER_DAY;
    const shutdownBudgetMs = Math.min(
      SHUTDOWN_COMPACTION_MAX_BUDGET_MS,
      Math.max(1, ENV.backgroundTaskTimeoutMs)
    );
    const shutdownDeadline = Date.now() + shutdownBudgetMs;
    let compactedTotal = 0;
    while (Date.now() < shutdownDeadline) {
      const result = await sessionRepo.compactMessages({
        beforeTimestamp: compactBeforeTs,
        batchSize: ENV.sqliteRetentionCompactionBatchSize,
      });
      compactedTotal += result.compacted;
      if (result.compacted === 0) {
        break;
      }
    }
    if (compactedTotal > 0) {
      logger.info("Shutdown storage compaction completed", {
        compactedTotal,
        budgetMs: shutdownBudgetMs,
      });
    }

    try {
      await runSqliteRuntimeMaintenance();
    } catch (error) {
      logger.warn("SQLite runtime maintenance failed during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await closeSqliteStorage();
  };

  process.on("SIGTERM", () => {
    gracefulShutdown("SIGTERM").catch((error) => {
      logger.error("Graceful shutdown failed after SIGTERM", error as Error);
    });
  });
  process.on("SIGINT", () => {
    gracefulShutdown("SIGINT").catch((error) => {
      logger.error("Graceful shutdown failed after SIGINT", error as Error);
    });
  });

  return { server, wsHandler };
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    logger.error("Failed to start server", err as Error);
    process.exit(1);
  });
}
