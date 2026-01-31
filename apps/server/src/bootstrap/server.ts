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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebSocketServer } from "ws";
import { ENV } from "../config/environment";
import { auth, authConfig, authState } from "../infra/auth/auth";
import { ensureAuthSetup } from "../infra/auth/bootstrap";
import { getAuthContext, getSessionFromRequest } from "../infra/auth/guards";
import { registerHttpRoutes } from "../transport/http/routes";
import { buildDashboardData } from "../transport/http/ui/dashboard-data";
import { ConfigPage } from "../transport/http/ui/dashboard-view";
import { LoginPage } from "../transport/http/ui/login";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import { getContainer, initializeContainer } from "./container";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
/** Path to the public UI directory */
const PUBLIC_UI_PATH = join(__dirname, "../../public");
/** Regex to match UI path prefix */
const UI_PATH_PREFIX = /^\/ui\//;
/** Regex to remove leading slashes */
const LEADING_SLASHES = /^\/+/;

function normalizeOrigin(value: string | null): string | null {
  if (!value || value === "null") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function getForwardedProto(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  const cfVisitor = headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme) {
        return parsed.scheme;
      }
    } catch (error) {
      console.warn("[Auth] Failed to parse CF-Visitor header:", error);
    }
  }

  return null;
}

function resolveHostOrigin(headers: Headers): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) {
    return null;
  }
  const proto = getForwardedProto(headers) ?? "http";
  if (proto !== "http" && proto !== "https") {
    return null;
  }

  return `${proto}://${host}`;
}

function resolveRequestOrigin(headers: Headers): string | null {
  const originHeader = normalizeOrigin(headers.get("origin"));
  const hostOrigin = resolveHostOrigin(headers);
  if (originHeader) {
    if (hostOrigin && originHeader !== hostOrigin) {
      console.debug(
        `[Auth] Origin mismatch: origin="${originHeader}", hostOrigin="${hostOrigin}"`
      );
      return null;
    }
    console.debug(`[Auth] Using origin from header: ${originHeader}`);
    return originHeader;
  }
  console.debug(`[Auth] Using host origin: ${hostOrigin}`);
  return hostOrigin;
}

function resolveCorsOrigin(origin?: string | null): string | undefined {
  const normalized = normalizeOrigin(origin ?? null);
  if (!normalized) {
    console.debug(
      "[Auth] CORS origin null/undefined, allowing (credentials=true)"
    );
    // When credentials=true, returning undefined can cause issues
    // For Same-Origin requests or development, allow it
    return origin ?? undefined;
  }

  const trusted = authConfig.trustedOrigins;
  if (Array.isArray(trusted)) {
    if (trusted[0] === "*" || trusted.includes(normalized)) {
      return normalized;
    }
    // Debug: origin not in trusted list
    console.debug(
      `[Auth] CORS origin "${normalized}" not in trusted list: ${JSON.stringify(trusted)}, allowing anyway for dev`
    );
    return normalized; // Allow anyway for development
  }

  if (trusted === "*") {
    return normalized;
  }

  return trusted === normalized ? normalized : undefined;
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
  const container = initializeContainer();
  const settings = container.getSettings().get();
  initializeContainer(settings.projectRoots);

  const app = new Hono();
  app.use(logger());

  // Auth CORS + handler
  app.use("/api/auth/*", async (c, next) => {
    const origin = resolveRequestOrigin(c.req.raw.headers);
    if (origin) {
      ensureTrustedOrigin(origin);
    }
    return next();
  });

  app.use(
    "/api/auth/*",
    cors({
      origin: resolveCorsOrigin,
      allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    })
  );

  app.use(
    "/api/health",
    cors({
      origin: (origin) => origin ?? "*",
      allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      allowMethods: ["GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: false,
    })
  );

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
        console.error("Failed to verify API key:", error);
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

  // Serve UI static files
  app.use(
    "/ui/*",
    serveStatic({
      root: PUBLIC_UI_PATH,
      // Ensure the path is relative so Bun's path.join uses the root.
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
    const html = `<!DOCTYPE html>${LoginPage({
      username: ENV.authAdminUsername ?? authState.adminUsername ?? "admin",
    })}`;
    return c.html(html);
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
  registerHttpRoutes(app);

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
      console.error("Failed to load API keys:", error);
    }

    try {
      deviceSessions = await auth.api.listDeviceSessions({
        headers: c.req.raw.headers,
      });
    } catch (error) {
      console.error("Failed to load device sessions:", error);
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

    const html = `<!DOCTYPE html>${ConfigPage({
      settings,
      dashboardData,
      activeTab: tab,
      success: success === "1",
      notice: notice || undefined,
      errors: error ? { general: error } : undefined,
      requiresRestart,
    })}`;
    return c.html(html);
  });

  return app;
}

/**
 * Starts the server with HTTP and WebSocket support
 *
 * @returns Promise resolving to server objects
 */
export async function startServer() {
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

    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
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
      createTrpcContext({ req, connectionParams: info.connectionParams }),
  });

  server.listen(ENV.wsPort, ENV.wsHost);

  console.log(
    `[Server] HTTP UI + WebSocket running on http://${ENV.wsHost}:${ENV.wsPort}`
  );

  // Graceful shutdown
  process.on("SIGTERM", () => {
    wsHandler.broadcastReconnectNotification();
    wss.close();
    server.close();
  });

  return await { server, wsHandler };
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(console.error);
}
