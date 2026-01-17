import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { createContext } from "../trpc/context";
import type { AppRouter } from "../trpc/router";

export function createTrpcWebsocketServer(router: AppRouter) {
  const wss = new WebSocketServer({ noServer: true });
  const handler = applyWSSHandler({
    wss,
    router,
    createContext,
  });

  return { wss, handler };
}
