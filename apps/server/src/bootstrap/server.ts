// Main server bootstrap
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { WebSocketServer } from "ws";
import { ENV } from "../config/environment";
import { registerHttpRoutes } from "../transport/http/routes";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import { ConfigPage } from "../ui/config";
import { getContainer, initializeContainer } from "./container";

export function createApp() {
  // Initialize DI container with allowed roots from settings
  const container = initializeContainer();
  const settings = container.getSettings().get();
  initializeContainer(settings.projectRoots);

  const app = new Hono();
  app.use(logger());

  // Register HTTP routes
  registerHttpRoutes(app);

  // Dashboard UI
  app.get("/", (c) => {
    const html = `<!DOCTYPE html>${ConfigPage({
      settings: getContainer().getSettings().get(),
    })}`;
    return c.html(html);
  });

  return app;
}

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

  wss.on("connection", (ws, req) => {
    console.log("[Server] WS connection", req?.url);
    ws.on("close", (code, reason) => {
      console.log("[Server] WS closed", code, reason.toString());
    });
    ws.on("error", (err) => {
      console.error("[Server] WS error", err);
    });
  });

  // Start server
  server.listen(ENV.wsPort, ENV.wsHost, () => {
    console.log(
      `[Server] HTTP UI + WebSocket running on http://${ENV.wsHost}:${ENV.wsPort}`
    );
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    handler.broadcastReconnectNotification();
    wss.close();
    server.close();
  });

  return await { server, wss, handler };
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(console.error);
}
