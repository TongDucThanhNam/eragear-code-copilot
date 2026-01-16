import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import type { AppRouter } from "../trpc/router";
import { createContext } from "../trpc/context";

export function createTrpcWebsocketServer(router: AppRouter) {
	const wss = new WebSocketServer({ noServer: true });
	const handler = applyWSSHandler({
		wss,
		router,
		createContext,
	});

	return { wss, handler };
}
