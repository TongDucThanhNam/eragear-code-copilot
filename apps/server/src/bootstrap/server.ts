/**
 * Server Bootstrap Module
 *
 * Initializes and starts the HTTP and WebSocket servers.
 * Sets up the Hono web framework, tRPC router, and WebSocket handler for
 * real-time communication with the ACP client.
 *
 * @module bootstrap/server
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ENV } from "../config/environment";
import { auth, authState } from "../infra/auth/auth";
import { ensureAuthSetup } from "../infra/auth/bootstrap";
import { getSessionFromRequest } from "../infra/auth/guards";
import { LoginPage } from "../shared/config/login";
import { ConfigPage } from "../shared/config/ui";
import { registerHttpRoutes } from "../transport/http/routes";
import { createBunTrpcWsHandler } from "../transport/trpc/bun-ws";
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
  app.use(
    "/api/auth/*",
    cors({
      origin: ENV.authTrustedOrigins,
      credentials: true,
    })
  );

  app.all("/api/auth/*", async (c) => {
    const path = c.req.path;
    const isSignup = path.startsWith("/api/auth/sign-up");
    const isUsernameAvailability = path.startsWith(
      "/api/auth/is-username-available"
    );

    if (
      !ENV.authAllowSignup &&
      authState.hasUsers &&
      (isSignup || isUsernameAvailability)
    ) {
      return c.json({ error: "Sign-up is disabled" }, 403);
    }

    return await auth.handler(c.req.raw);
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
    if (c.req.path.startsWith("/api/auth")) {
      return next();
    }
    const session = await getSessionFromRequest({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
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
    const html = `<!DOCTYPE html>${ConfigPage({
      settings: getContainer().getSettings().get(),
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
  const wsHandler = createBunTrpcWsHandler({
    router: appRouter,
    createContext: createTrpcContext,
    keepAliveMs: ENV.wsHeartbeatIntervalMs,
  });

  // Start HTTP + WebSocket server (Bun-native)
  const server = Bun.serve({
    hostname: ENV.wsHost,
    port: ENV.wsPort,
    fetch(req, serverInstance) {
      const upgradeHeader = req.headers.get("upgrade");
      if (upgradeHeader?.toLowerCase() === "websocket") {
        if (wsHandler.tryUpgrade(req, serverInstance)) {
          return;
        }
        return new Response("Upgrade failed", { status: 400 });
      }
      return app.fetch(req);
    },
    websocket: wsHandler.websocket,
  });

  console.log(
    `[Server] HTTP UI + WebSocket running on http://${ENV.wsHost}:${ENV.wsPort}`
  );

  // Graceful shutdown
  process.on("SIGTERM", () => {
    wsHandler.broadcastReconnectNotification();
    wsHandler.stop();
    server.stop();
  });

  return await { server, wsHandler };
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(console.error);
}
