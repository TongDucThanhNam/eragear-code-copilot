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
import { getRequestListener } from "@hono/node-server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { ENV } from "../config/environment";
import { ConfigPage } from "../shared/config/ui";
import { registerHttpRoutes } from "../transport/http/routes";
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

  // Create HTTP + WebSocket server
  const server = createServer(getRequestListener(app.fetch));

  // Setup WebSocket for tRPC
  const wss = new WebSocketServer({ noServer: true });
  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: createTrpcContext,
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  /**
   * Marks a WebSocket connection as alive (for heartbeat)
   */
  const markAlive = (socket: WebSocket & { isAlive?: boolean }) => {
    socket.isAlive = true;
  };

  wss.on("connection", (ws, req) => {
    console.log("[Server] WS connection", req?.url);
    markAlive(ws);

    ws.on("pong", () => {
      markAlive(ws);
    });

    ws.on("close", (code, reason) => {
      console.log("[Server] WS closed", code, reason.toString());
    });
    ws.on("error", (err) => {
      console.error("[Server] WS error", err);
    });
  });

  // Heartbeat interval to detect dead connections
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      const socket = ws as WebSocket & { isAlive?: boolean };
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, ENV.wsHeartbeatIntervalMs);

  // Start server
  server.listen(ENV.wsPort, ENV.wsHost, () => {
    console.log(
      `[Server] HTTP UI + WebSocket running on http://${ENV.wsHost}:${ENV.wsPort}`
    );
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    handler.broadcastReconnectNotification();
    clearInterval(heartbeatInterval);
    wss.close();
    server.close();
  });

  return await { server, wss, handler };
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(console.error);
}
