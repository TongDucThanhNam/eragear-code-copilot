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
import { logger } from "hono/logger";
import { ENV } from "../config/environment";
import { ConfigPage } from "../shared/config/ui";
import { registerHttpRoutes } from "../transport/http/routes";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import { createBunTrpcWsHandler } from "../transport/trpc/bun-ws";
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

  // Register HTTP routes
  registerHttpRoutes(app);

  // Dashboard UI - serves the main configuration page
  app.get("/", (c) => {
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
