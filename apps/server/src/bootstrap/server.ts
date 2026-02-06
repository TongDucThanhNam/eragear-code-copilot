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
import { auth, authConfig, authState } from "../infra/auth/auth";
import { ensureAuthSetup } from "../infra/auth/bootstrap";
import { getAuthContext } from "../infra/auth/guards";
import { installConsoleLogger } from "../infra/logging/logger";
import { createRequestLogger } from "../infra/logging/request-logger";
import { createLogger } from "../infra/logging/structured-logger";
import { ReconcileSessionStatusService } from "../modules/session/application/reconcile-session-status.service";
import { normalizeOrigin } from "../transport/http/cors";
import { createCorsMiddlewares } from "../transport/http/cors-factory";
import { createErrorHandler } from "../transport/http/error-handler";
import { requestIdMiddleware } from "../transport/http/request-id";
import { registerHttpRoutes } from "../transport/http/routes";
import { registerDashboardUiRoutes } from "../transport/http/routes/dashboard";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import type { WebSocketHandlerInfo } from "../transport/trpc/types";
import { initializeContainer } from "./container";

const logger = createLogger("Server");

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

function ensureTrustedOrigin(origin: string) {
  const trusted = authConfig.trustedOrigins;
  if (
    Array.isArray(trusted) &&
    trusted[0] !== "*" &&
    !trusted.includes(origin)
  ) {
    trusted.push(origin);
  }

  if (authConfig.baseURL !== origin) {
    authConfig.baseURL = origin;
  }
}

/**
 * Creates the Hono application with all middleware and routes
 *
 * @returns Configured Hono application instance
 */
export function createApp() {
  // Initialize DI container with allowed roots from settings
  const initialContainer = initializeContainer();
  const settings = initialContainer.getSettings().get();
  const container = initializeContainer(settings.projectRoots);
  new ReconcileSessionStatusService(
    container.getSessions(),
    container.getSessionRuntime()
  ).execute();

  const app = new Hono();
  app.use(
    "*",
    reactRenderer(({ children }) => createElement(Fragment, null, children))
  );
  app.use(createRequestLogger());

  // Add request ID for tracing
  app.use(requestIdMiddleware());

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

  // Auth CORS + handler
  app.use("/api/auth/*", (c, next) => {
    const origin = normalizeOrigin(c.req.raw.headers.get("origin"));
    if (origin) {
      ensureTrustedOrigin(origin);
    }
    return next();
  });

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
  const app = createApp();
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
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (req.method === "HEAD" || response.status === 204) {
      res.end();
      return;
    }

    await pipeResponseBody(res, response);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const wsHandler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: ({ req, info }) =>
      createTrpcContext({
        req,
        connectionParams: (info as WebSocketHandlerInfo)?.connectionParams,
      }),
  });

  server.listen(ENV.wsPort, ENV.wsHost);

  logger.info("HTTP + WebSocket server started", {
    host: ENV.wsHost,
    port: ENV.wsPort,
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, gracefully shutting down");
    wsHandler.broadcastReconnectNotification();
    wss.close();
    server.close();
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
