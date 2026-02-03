/**
 * Server Bootstrap Module
 *
 * Initializes and starts the HTTP and WebSocket servers.
 * Sets up the Hono web framework, tRPC router, and WebSocket handler for
 * real-time communication with the ACP client.
 *
 * @module bootstrap/server
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compress } from "hono/compress";
import { reactRenderer } from "@hono/react-renderer";
import type { ViteDevServer } from "vite";
import { WebSocketServer } from "ws";
import { createElement, Fragment } from "react";
import { ENV } from "../config/environment";
import { auth, authConfig, authState } from "../infra/auth/auth";
import { ensureAuthSetup } from "../infra/auth/bootstrap";
import { getAuthContext, getSessionFromRequest } from "../infra/auth/guards";
import { createLogger } from "../infra/logging/structured-logger";
import { installConsoleLogger } from "../infra/logging/logger";
import { createRequestLogger } from "../infra/logging/request-logger";
import {
  PUBLIC_UI_PATH,
  UI_PATH_PREFIX,
  LEADING_SLASHES,
} from "../transport/http/constants";
import {
  resolveRequestOrigin,
} from "../transport/http/cors";
import { createCorsMiddlewares } from "../transport/http/cors-factory";
import { createErrorHandler } from "../transport/http/error-handler";
import { requestIdMiddleware } from "../transport/http/request-id";
import { registerHttpRoutes } from "../transport/http/routes";
import { buildDashboardData } from "../transport/http/ui/dashboard-data";
import { ConfigPage } from "../transport/http/ui/dashboard-view";
import { LoginHead, LoginPage } from "../transport/http/ui/login";
import { renderDocument } from "../transport/http/ui/render-document";
import { UI_STYLE_SOURCE_PATH } from "../transport/http/ui/ui-assets";
import type { WebSocketHandlerInfo } from "../transport/trpc/types";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import { getContainer, initializeContainer } from "./container";

const logger = createLogger("Server");
const viteRef: { current: ViteDevServer | null } = { current: null };

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

function isViteHmrUpgrade(req: IncomingMessage): boolean {
  const protocol = req.headers["sec-websocket-protocol"];
  if (Array.isArray(protocol)) {
    if (protocol.some((value) => value.includes("vite-hmr"))) {
      return true;
    }
  } else if (typeof protocol === "string" && protocol.includes("vite-hmr")) {
    return true;
  }
  const url = req.url ?? "";
  return url.startsWith("/ui/@vite") || url.startsWith("/@vite");
}

async function handleViteRequest(
  vite: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  await new Promise<void>((resolve, reject) => {
    vite.middlewares(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
  return res.writableEnded || res.headersSent;
}

async function createViteDevServer(
  server: ReturnType<typeof createServer>
): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const root = fileURLToPath(new URL("../../ui", import.meta.url));
  return createViteServer({
    root,
    base: "/ui/",
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    plugins: [react()],
  });
}

/**
 * Creates the Hono application with all middleware and routes
 *
 * @returns Configured Hono application instance
 */
export function createApp() {
  // Initialize DI container with allowed roots from settings
  const container = initializeContainer();
  const settings = container.getSettings().get();
  initializeContainer(settings.projectRoots);

  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("vite", viteRef.current);
    return next();
  });
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
  const corsMiddleware = createCorsMiddlewares(authConfig.trustedOrigins);

  // Apply API CORS defaults (auth/health override below)
  app.use("/api/*", corsMiddleware.api);

  // Auth CORS + handler
  app.use("/api/auth/*", async (c, next) => {
    const origin = resolveRequestOrigin(c.req.raw.headers);
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

  // Serve UI static files with cache headers
  if (ENV.isDev) {
    app.get("/ui/styles.css", async (c) => {
      const css = await readFile(UI_STYLE_SOURCE_PATH, "utf8");
      c.res.headers.set("Content-Type", "text/css; charset=UTF-8");
      c.res.headers.set("Cache-Control", "no-cache");
      return c.body(css);
    });
  }

  app.use("/ui/*", async (c, next) => {
    // Long-term caching for static assets (1 year)
    c.res.headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );
    return next();
  });

  app.use(
    "/ui/*",
    serveStatic({
      root: PUBLIC_UI_PATH,
      rewriteRequestPath: (path) =>
        path.replace(UI_PATH_PREFIX, "").replace(LEADING_SLASHES, ""),
    })
  );

  // Login page
  app.get("/login", async (c) => {
    const session = await getSessionFromRequest({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (session) {
      return c.redirect("/");
    }
    const username = ENV.authAdminUsername ?? authState.adminUsername ?? "admin";
    return renderDocument(c, createElement(LoginPage, { username }), {
      title: "Eragear Server Login",
      head: createElement(LoginHead, { username }),
      bodyClassName:
        "flex min-h-screen flex-col bg-[#F9F9F7] font-body text-[#111111] antialiased",
    });
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

  // Protect UI form submissions
  app.use("/form/*", async (c, next) => {
    const session = await getSessionFromRequest({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!session) {
      return c.redirect("/login");
    }
    return next();
  });

  // Register HTTP routes
  const api = new Hono();
  const form = new Hono();
  registerHttpRoutes(api, form);
  app.route("/api", api);
  app.route("/form", form);

  // Dashboard UI - serves the main configuration page
  app.get("/", async (c) => {
    const session = await getSessionFromRequest({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!session) {
      return c.redirect("/login");
    }
    const container = getContainer();
    const settings = container.getSettings().get();
    const projects = container.getProjects().findAll();
    const storedSessions = container.getSessions().findAll();
    const runtimeSessions = container.getSessionRuntime();
    const agents = container.getAgents().findAll();

    let apiKeys: unknown = [];
    let deviceSessions: unknown = [];

    try {
      apiKeys = await auth.api.listApiKeys({ headers: c.req.raw.headers });
    } catch (error) {
      logger.error("Failed to load API keys", error as Error);
    }

    try {
      deviceSessions = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });
    } catch (error) {
      logger.error("Failed to load device sessions", error as Error);
    }

    const dashboardData = buildDashboardData({
      projects,
      sessions: storedSessions,
      runtimeSessions,
      agents,
      apiKeys: Array.isArray(apiKeys) ? apiKeys : [],
      deviceSessions: Array.isArray(deviceSessions) ? deviceSessions : [],
    });

    const { tab, success, error, notice, restart } = c.req.query();
    const requiresRestart = restart
      ? restart
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;

    return renderDocument(
      c,
      createElement(ConfigPage, {
        settings,
        dashboardData,
        activeTab: tab,
        success: success === "1",
        notice: notice || undefined,
        errors: error ? { general: error } : undefined,
        requiresRestart,
      }),
      {
        title: "Eragear Server Dashboard",
        bodyClassName: "bg-paper font-body text-ink antialiased",
        bodyAttributes: { "data-active-tab": tab },
      }
    );
  });

  // Explicit 404 handler for better UX
  app.notFound((c) =>
    c.json({ error: "Not found", path: c.req.path }, 404)
  );

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
  let vite: ViteDevServer | null = null;
  const server = createServer(async (req, res) => {
    const requestUrl = req.url ?? "/";
    const requestPath = requestUrl.split("?")[0] ?? "";
    if (vite && requestPath !== "/ui/styles.css") {
      try {
        const handled = await handleViteRequest(vite, req, res);
        if (handled) {
          return;
        }
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        logger.error("Vite middleware error", error as Error);
        res.statusCode = 500;
        res.end();
        return;
      }
    }

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

  if (ENV.isDev) {
    try {
      vite = await createViteDevServer(server);
      viteRef.current = vite;
      logger.info("Vite dev middleware enabled", { base: "/ui/" });
    } catch (error) {
      logger.error("Failed to start Vite dev middleware", error as Error);
    }
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (vite && isViteHmrUpgrade(req)) {
      return;
    }
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
    void vite?.close();
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
