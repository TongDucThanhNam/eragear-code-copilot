import { createServer } from "node:http";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { ENV } from "./config/environment";
import { appRouter } from "./trpc/router";
import { createTrpcWebsocketServer } from "./websocket/adapter";
import { attachWebsocketHandlers } from "./websocket/handler";

const app = new Hono();
app.use(logger());

const server = createServer();
const { wss, handler } = createTrpcWebsocketServer(appRouter);

attachWebsocketHandlers(server, wss);

server.listen(ENV.wsPort, ENV.wsHost, () => {
	console.log(
		`[Server] WebSocket Server running on ws://${ENV.wsHost}:${ENV.wsPort}`,
	);
});

process.on("SIGTERM", () => {
	handler.broadcastReconnectNotification();
	wss.close();
	server.close();
});

export default app;
