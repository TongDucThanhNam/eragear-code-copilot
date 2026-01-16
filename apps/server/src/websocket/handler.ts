import type { Server } from "node:http";
import type { WebSocketServer } from "ws";

export function attachWebsocketHandlers(server: Server, wss: WebSocketServer) {
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
}
