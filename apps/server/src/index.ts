import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { WebSocketServer } from "ws";
import { appRouter } from "./trpc";

const app = new Hono();
app.use(logger());

// --- WebSocket Server ---
import { createServer } from "node:http";

const server = createServer();
const wss = new WebSocketServer({ noServer: true });

const handler = applyWSSHandler({
	wss,
	router: appRouter,
	createContext: () => ({}),
});

server.on("upgrade", (req, socket, head) => {


	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit("connection", ws, req);
	});
});

server.listen(3003, () => {
	console.log("[Server] WebSocket Server running on ws://localhost:3003");
});

process.on("SIGTERM", () => {
	handler.broadcastReconnectNotification();
	wss.close();
	server.close();
});

export default app;
