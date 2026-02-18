import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createLogger } from "../platform/logging/structured-logger";
import { applyFetchHeadersToNodeResponse } from "../transport/http/utils/response-headers";
import type { ServerRuntimePolicy } from "./server-runtime-policy";

const logger = createLogger("Server");

export const INTERNAL_REMOTE_ADDRESS_HEADER = "x-eragear-remote-address";

interface FetchHandlerApp {
  fetch(request: Request): Response | Promise<Response>;
}

async function pipeResponseBody(
  res: ServerResponse,
  response: Response
): Promise<void> {
  const body = response.body;
  if (!body) {
    res.end();
    return;
  }

  const fromWeb = (
    Readable as typeof Readable & {
      fromWeb?: (stream: ReadableStream) => NodeJS.ReadableStream;
    }
  ).fromWeb;
  if (typeof fromWeb !== "function") {
    throw new Error(
      "Readable.fromWeb is unavailable. Bun runtime requirements are not met."
    );
  }

  const stream = fromWeb(body as unknown as ReadableStream);
  await pipeline(stream as NodeJS.ReadableStream, res);
}

function buildFetchRequestFromNode(
  req: IncomingMessage,
  runtimePolicy: ServerRuntimePolicy
): Request {
  const host =
    req.headers.host ?? `${runtimePolicy.wsHost}:${runtimePolicy.wsPort}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
      continue;
    }
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const remoteAddress = req.socket.remoteAddress;
  if (typeof remoteAddress === "string" && remoteAddress.trim().length > 0) {
    headers.set(INTERNAL_REMOTE_ADDRESS_HEADER, remoteAddress.trim());
  }
  const requestInit: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    body:
      req.method && req.method !== "GET" && req.method !== "HEAD"
        ? (req as unknown as BodyInit)
        : undefined,
    duplex: "half",
  };
  return new Request(url, requestInit);
}

async function writeFetchResponseToNode(
  req: IncomingMessage,
  res: ServerResponse,
  response: Response
): Promise<void> {
  res.statusCode = response.status;
  applyFetchHeadersToNodeResponse(res, response.headers);
  if (req.method === "HEAD" || response.status === 204) {
    res.end();
    return;
  }
  await pipeResponseBody(res, response);
}

export async function handleNodeHttpRequest(params: {
  app: FetchHandlerApp;
  req: IncomingMessage;
  res: ServerResponse;
  runtimePolicy: ServerRuntimePolicy;
}): Promise<void> {
  const { app, req, res, runtimePolicy } = params;
  try {
    const request = buildFetchRequestFromNode(req, runtimePolicy);
    const response = await app.fetch(request);
    await writeFetchResponseToNode(req, res, response);
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    logger.error("HTTP request handling failed", normalizedError, {
      method: req.method ?? "GET",
      path: req.url ?? "/",
    });

    if (!(res.headersSent || res.writableEnded || res.destroyed)) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Internal Server Error" }));
      return;
    }
    if (!(res.writableEnded || res.destroyed)) {
      res.destroy(normalizedError);
    }
  }
}
