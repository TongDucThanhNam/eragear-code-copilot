import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/serve-static";
import { ENV } from "./config/environment";
import { getSettings, updateSettings } from "./config/settings";
import { appRouter } from "./trpc/router";
import { createTrpcWebsocketServer } from "./websocket/adapter";
import { attachWebsocketHandlers } from "./websocket/handler";

const app = new Hono();
app.use(logger());

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uiDistPath = path.resolve(currentDir, "../../server-ui/dist");
const uiIndexPath = path.join(uiDistPath, "index.html");

app.get("/", (c) => {
  return c.json({
    status: "ok",
    configUi: "/config",
  });
});

app.get("/api/ui-settings", (c) => {
  return c.json(getSettings());
});

app.put("/api/ui-settings", async (c) => {
  const body = await c.req.json();
  const next = updateSettings(body ?? {});
  return c.json(next);
});

app.get("/config", (c) => {
  if (!existsSync(uiIndexPath)) {
    return c.html(
      "<h1>Config UI chưa được build</h1><p>Chạy <code>bun run build</code> trong <code>apps/server-ui</code> trước.</p>",
      503
    );
  }
  return c.html(readFileSync(uiIndexPath, "utf-8"));
});

app.get(
  "/config/*",
  serveStatic({
    root: uiDistPath,
    rewriteRequestPath: (path) => path.replace(/^\/config/, ""),
  })
);

const server = createServer(getRequestListener(app.fetch));
const { wss, handler } = createTrpcWebsocketServer(appRouter);

attachWebsocketHandlers(server, wss);

server.listen(ENV.wsPort, ENV.wsHost, () => {
  console.log(
    `[Server] HTTP UI running on http://${ENV.wsHost}:${ENV.wsPort}/config`
  );
  console.log(
    `[Server] WebSocket Server running on ws://${ENV.wsHost}:${ENV.wsPort}`
  );
});

process.on("SIGTERM", () => {
  handler.broadcastReconnectNotification();
  wss.close();
  server.close();
});

export default app;
