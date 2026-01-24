/**
 * Bun WebSocket adapter for tRPC
 *
 * Provides a Bun-native WebSocket implementation while keeping tRPC WS semantics.
 */

import { EventEmitter } from "node:events";
import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import type { WSSHandlerOptions } from "@trpc/server/adapters/ws";
import type { AnyRouter } from "@trpc/server";

type NodeLikeRequest = {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { encrypted?: boolean };
};

type BunServerWebSocketLike = {
  send: (data: string | Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
  ping?: (data?: string | ArrayBuffer | Uint8Array) => number;
  terminate?: () => void;
  data?: unknown;
};

class BunWebSocketWrapper {
  readyState = 1;
  isAlive = true;
  private readonly emitter = new EventEmitter();
  private readonly ws: BunServerWebSocketLike;

  constructor(ws: BunServerWebSocketLike) {
    this.ws = ws;
  }

  on(
    event: "message" | "close" | "error",
    listener: (...args: unknown[]) => void
  ) {
    this.emitter.on(event, listener);
    return this;
  }

  once(
    event: "message" | "close" | "error",
    listener: (...args: unknown[]) => void
  ) {
    this.emitter.once(event, listener);
    return this;
  }

  send(data: string) {
    this.ws.send(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.ws.close(code, reason);
  }

  terminate() {
    this.readyState = 3;
    if (typeof this.ws.terminate === "function") {
      this.ws.terminate();
      return;
    }
    this.ws.close(1000, "terminate");
  }

  ping() {
    if (typeof this.ws.ping === "function") {
      this.ws.ping();
      return;
    }
    this.ws.send("PING");
  }

  markAlive() {
    this.isAlive = true;
  }

  emitMessage(data: string | Buffer) {
    this.emitter.emit("message", data);
  }

  emitClose() {
    this.readyState = 3;
    this.emitter.emit("close");
  }

  emitError(error: unknown) {
    this.emitter.emit("error", error);
  }
}

function toNodeLikeRequest(req: Request): NodeLikeRequest {
  let url: URL;
  try {
    const host = req.headers.get("host") ?? "localhost";
    const base = host.includes("://") ? host : `http://${host}`;
    const rawUrl = req.url && req.url.length > 0 ? req.url : "/";
    url = new URL(rawUrl, base);
  } catch {
    url = new URL("http://localhost/");
  }

  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of req.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }
  if (!headers.host) {
    headers.host = url.host;
  }

  return {
    url: `${url.pathname}${url.search}`,
    headers,
    socket: { encrypted: url.protocol === "https:" },
  };
}

function normalizeMessage(
  message: string | Uint8Array | ArrayBuffer
): string | Buffer {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return Buffer.from(message);
  }
  if (Buffer.isBuffer(message)) {
    return message;
  }
  return Buffer.from(message);
}

export function createBunTrpcWsHandler<TRouter extends AnyRouter>(opts: {
  router: TRouter;
  createContext: WSSHandlerOptions<TRouter>["createContext"];
  keepAliveMs?: number;
}) {
  const connections = new Set<BunWebSocketWrapper>();
  const onConnection = getWSConnectionHandler<TRouter>({
    router: opts.router,
    createContext: opts.createContext,
    keepAlive: { enabled: false },
  });

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  if (opts.keepAliveMs !== undefined) {
    heartbeatTimer = setInterval(() => {
      for (const client of connections) {
        if (!client.isAlive) {
          client.terminate();
          connections.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, opts.keepAliveMs);
  }

  return {
    tryUpgrade(request: Request, server: { upgrade: (req: Request, opts?: { data?: unknown }) => boolean }) {
      return server.upgrade(request, { data: { request } });
    },
    websocket: {
      open(ws: BunServerWebSocketLike & { data?: unknown }) {
        const data = ws.data as { request?: Request } | undefined;
        const request = data?.request ?? new Request("http://localhost/");
        const nodeReq = toNodeLikeRequest(request);
        const wrapper = new BunWebSocketWrapper(ws);
        ws.data = { ...data, wrapper, nodeReq };
        connections.add(wrapper);
        wrapper.markAlive();
        onConnection(wrapper as unknown as Parameters<typeof onConnection>[0], nodeReq as any);
      },
      message(ws: BunServerWebSocketLike & { data?: unknown }, message: string | Uint8Array | ArrayBuffer) {
        const data = ws.data as { wrapper?: BunWebSocketWrapper } | undefined;
        const wrapper = data?.wrapper;
        if (!wrapper) {
          return;
        }
        wrapper.markAlive();
        wrapper.emitMessage(normalizeMessage(message));
      },
      pong(ws: BunServerWebSocketLike & { data?: unknown }) {
        const data = ws.data as { wrapper?: BunWebSocketWrapper } | undefined;
        const wrapper = data?.wrapper;
        if (wrapper) {
          wrapper.markAlive();
        }
      },
      close(
        ws: BunServerWebSocketLike & { data?: unknown },
        _code: number,
        _reason: string
      ) {
        const data = ws.data as { wrapper?: BunWebSocketWrapper } | undefined;
        const wrapper = data?.wrapper;
        if (!wrapper) {
          return;
        }
        wrapper.emitClose();
        connections.delete(wrapper);
      },
    },
    broadcastReconnectNotification() {
      const payload = JSON.stringify({ id: null, method: "reconnect" });
      for (const client of connections) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    },
    stop() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    },
  };
}
