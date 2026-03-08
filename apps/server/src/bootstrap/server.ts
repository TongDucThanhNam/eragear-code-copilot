/**
 * Server Bootstrap Module
 *
 * Initializes and starts the HTTP and WebSocket servers.
 * Sets up the Hono web framework, tRPC router, and WebSocket handler for
 * real-time communication with the ACP client.
 *
 * @module bootstrap/server
 */

import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { reactRenderer } from "@hono/react-renderer";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createElement, Fragment } from "react";
import { WebSocketServer } from "ws";
import { installConsoleLogger } from "../platform/logging/logger";
import { createRequestLogger } from "../platform/logging/request-logger";
import { createLogger } from "../platform/logging/structured-logger";
import { patchObservabilityContext } from "../shared/utils/observability-context.util";
import { withTimeout } from "../shared/utils/timeout.util";
import { createCorsMiddlewares } from "../transport/http/cors-factory";
import { createErrorHandler } from "../transport/http/error-handler";
import { requestIdMiddleware } from "../transport/http/request-id";
import { registerHttpRoutes } from "../transport/http/routes";
import { registerDashboardUiRoutes } from "../transport/http/routes/dashboard";
import type { HttpRouteDependencies } from "../transport/http/routes/deps";
import {
  isJsonBodyParseError,
  parseJsonBodyWithLimit,
} from "../transport/http/routes/helpers";
import { createTrpcContext } from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import {
  type AppComposition,
  createAppCompositionFromSettings,
} from "./composition";
import {
  type CloudflareAccessHandshakePolicy,
  hasCloudflareAccessHandshakeAuth as hasCloudflareAccessHandshakeAuthInternal,
  validateCloudflareAccessHandshakeAuth,
} from "./server-cloudflare-access";
import {
  createBootstrappedAuthResolver,
  createHttpRouteDependencies,
  createTrpcContextDependencies,
} from "./server-dependencies";
import {
  handleNodeHttpRequest,
  INTERNAL_REMOTE_ADDRESS_HEADER,
} from "./server-http-bridge";
import {
  isPublicApiRoute,
  shouldForwardToRuntimeWriter,
} from "./server-route-policy";
import {
  forwardRequestToRuntimeWriter,
  RUNTIME_INTERNAL_TOKEN_HEADER,
  RUNTIME_WRITER_URL_HEADER,
} from "./server-runtime-forwarding";
import type { ServerRuntimePolicy as RuntimePolicy } from "./server-runtime-policy";

const logger = createLogger("Server");
const SHUTDOWN_FORCE_EXIT_TIMEOUT_MS = 15_000;
const TRPC_WS_PATH = "/trpc";

export type ServerRuntimePolicy = RuntimePolicy;

function toCloudflareAccessHandshakePolicy(
  runtimePolicy: RuntimePolicy
): CloudflareAccessHandshakePolicy {
  const hasJwtVerifier =
    Boolean(runtimePolicy.authCloudflareAccessJwtPublicKeyPem) &&
    Boolean(runtimePolicy.authCloudflareAccessJwtAudience) &&
    Boolean(runtimePolicy.authCloudflareAccessJwtIssuer);
  return {
    clientId: runtimePolicy.authCloudflareAccessClientId,
    clientSecret: runtimePolicy.authCloudflareAccessClientSecret,
    jwt: hasJwtVerifier
      ? {
          publicKeyPem: runtimePolicy.authCloudflareAccessJwtPublicKeyPem ?? "",
          audience: runtimePolicy.authCloudflareAccessJwtAudience ?? "",
          issuer: runtimePolicy.authCloudflareAccessJwtIssuer ?? "",
        }
      : undefined,
  };
}

export function hasCloudflareAccessHandshakeAuth(
  headers: IncomingMessage["headers"],
  runtimePolicy: RuntimePolicy
) {
  return hasCloudflareAccessHandshakeAuthInternal(
    headers,
    toCloudflareAccessHandshakePolicy(runtimePolicy)
  );
}

interface ShutdownTaskState {
  firstError: Error | null;
}

function captureShutdownError(state: ShutdownTaskState, error: unknown): void {
  if (state.firstError) {
    return;
  }
  state.firstError =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Shutdown error"));
}

async function runShutdownStep(
  state: ShutdownTaskState,
  step: () => Promise<void>
): Promise<void> {
  try {
    await step();
  } catch (error) {
    captureShutdownError(state, error);
  }
}

/**
 * Creates the Hono application with all middleware and routes
 *
 * @returns Configured Hono application instance
 */
export function createApp(
  composition: AppComposition,
  resolveAuthContextOverride?: HttpRouteDependencies["resolveAuthContext"]
) {
  const runtimePolicy = composition.runtimePolicy;
  const deps = composition.deps;
  const authRuntime = deps.authRuntime;
  const resolveAuthContext =
    resolveAuthContextOverride ?? createBootstrappedAuthResolver(deps);
  const httpDeps = createHttpRouteDependencies(
    deps,
    runtimePolicy,
    resolveAuthContext
  );

  const app = new Hono();
  app.use(
    "*",
    reactRenderer(({ children }) => createElement(Fragment, null, children))
  );
  app.use(requestIdMiddleware());
  app.use(createRequestLogger());

  app.use("/api/*", async (c, next) => {
    const contentLengthHeader = c.req.header("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        return c.json({ error: "Invalid content-length header" }, 400);
      }
      const normalizedContentLength = Math.trunc(contentLength);
      if (normalizedContentLength > runtimePolicy.httpMaxBodyBytes) {
        return c.json(
          {
            error: `Request payload exceeds limit (${normalizedContentLength} > ${runtimePolicy.httpMaxBodyBytes} bytes)`,
          },
          413
        );
      }
    }
    return await next();
  });

  app.use("/api/*", async (c, next) => {
    const forwarded = c.req.header("x-eragear-runtime-forwarded");
    if (forwarded !== "1") {
      return await next();
    }
    if (runtimePolicy.runtimeNodeRole !== "writer") {
      return c.json({ error: "Runtime forwarded request denied" }, 403);
    }
    const expectedToken = runtimePolicy.runtimeInternalToken;
    if (!expectedToken) {
      return c.json(
        { error: "Runtime internal forwarding token is not configured" },
        503
      );
    }
    const providedToken = c.req.header(RUNTIME_INTERNAL_TOKEN_HEADER);
    if (providedToken !== expectedToken) {
      return c.json({ error: "Invalid runtime forwarding token" }, 403);
    }
    return await next();
  });

  // Response timing middleware for performance monitoring
  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    c.res.headers.set("X-Response-Time", `${duration}ms`);
  });

  // Compression middleware - reduce response size by 60-70%
  if (typeof globalThis.CompressionStream === "function") {
    app.use(compress());
  } else {
    logger.warn("Compression disabled: CompressionStream is not available");
  }

  // Create reusable CORS middleware factory
  const corsMiddleware = createCorsMiddlewares(
    authRuntime.authConfig.trustedOrigins,
    runtimePolicy.corsStrictOrigin
  );

  // Auth CORS
  app.use("/api/auth/*", corsMiddleware.auth);

  app.use("/api/health", corsMiddleware.health);

  app.use("/api/*", (c, next) => {
    if (isPublicApiRoute(c.req.method, c.req.path)) {
      return next();
    }
    return corsMiddleware.api(c, next);
  });

  app.use("/api/*", async (c, next) => {
    if (runtimePolicy.runtimeNodeRole !== "reader") {
      return await next();
    }
    if (!shouldForwardToRuntimeWriter(c.req.method, c.req.path)) {
      return await next();
    }
    return await forwardRequestToRuntimeWriter({
      request: c.req.raw,
      runtimePolicy,
    });
  });

  app.all("/api/auth/*", async (c) => {
    const path = c.req.path;
    const method = c.req.method;
    if (!isPublicApiRoute(method, path)) {
      const authContext = await resolveAuthContext({
        headers: c.req.raw.headers,
        url: c.req.raw.url,
        remoteAddress: c.req.header(INTERNAL_REMOTE_ADDRESS_HEADER),
      });
      if (!authContext) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }
    const isSignup = path.startsWith("/api/auth/sign-up");
    const isUsernameAvailability = path.startsWith(
      "/api/auth/is-username-available"
    );

    if (path === "/api/auth/api-key/verify" && c.req.method === "POST") {
      try {
        const body = await parseJsonBodyWithLimit<Record<string, unknown>>(
          c.req.raw,
          runtimePolicy.httpMaxBodyBytes
        );
        const payload = body as {
          key: string;
          permissions?: Record<string, string[]>;
        };
        if (
          typeof payload.key !== "string" ||
          payload.key.trim().length === 0
        ) {
          return c.json({ error: "key is required" }, 400);
        }
        const result = await authRuntime.auth.api.verifyApiKey({
          body: payload,
        });
        return c.json(result);
      } catch (error) {
        if (isJsonBodyParseError(error)) {
          return c.json({ error: error.message }, error.statusCode);
        }
        logger.error("Failed to verify API key", error as Error);
        return c.json(
          {
            valid: false,
            error: { message: "Invalid API key", code: "INVALID_API_KEY" },
          },
          401
        );
      }
    }

    if (
      !runtimePolicy.authAllowSignup &&
      authRuntime.authState.hasUsers &&
      (isSignup || isUsernameAvailability)
    ) {
      return c.json({ error: "Sign-up is disabled" }, 403);
    }

    return await authRuntime.auth.handler(c.req.raw);
  });

  app.get("/api/health", (c) => {
    return c.json({ ok: true, ts: Date.now() });
  });

  // Protect API routes except explicit public allowlist entries.
  app.use("/api/*", async (c, next) => {
    if (isPublicApiRoute(c.req.method, c.req.path)) {
      return next();
    }
    const authContext = await resolveAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
      remoteAddress: c.req.header(INTERNAL_REMOTE_ADDRESS_HEADER),
    });
    if (!authContext) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    patchObservabilityContext({ userId: authContext.userId });
    return next();
  });

  // Register HTTP routes
  const api = new Hono();
  registerHttpRoutes(api, httpDeps);
  app.route("/api", api);
  registerDashboardUiRoutes(app, httpDeps);

  // Explicit 404 handler for better UX
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // Error handler for unhandled exceptions
  app.onError(createErrorHandler({ logger }));

  return app;
}

/**
 * Starts the server with HTTP and WebSocket support
 *
 * @returns Promise resolving to server objects
 */
export async function startServer() {
  installConsoleLogger();
  const composition = await createAppCompositionFromSettings();
  const runtimePolicy = composition.runtimePolicy;
  const deps = composition.deps;
  const resolveAuthContext = createBootstrappedAuthResolver(deps);
  await deps.lifecycle.prepareStartup();
  const trpcDeps = createTrpcContextDependencies(deps, resolveAuthContext);
  const app = createApp(composition, resolveAuthContext);
  deps.lifecycle.startBackground();

  const server = createServer(async (req, res) => {
    await handleNodeHttpRequest({
      app,
      req,
      res,
      runtimePolicy,
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: runtimePolicy.wsMaxPayloadBytes,
  });
  server.on("upgrade", (req, socket, head) => {
    if (runtimePolicy.runtimeNodeRole === "reader") {
      const writerHint = runtimePolicy.runtimeWriterUrl;
      const headers = [
        "HTTP/1.1 503 Service Unavailable",
        "Connection: close",
        "Content-Type: text/plain; charset=utf-8",
      ];
      if (writerHint) {
        headers.push(`${RUNTIME_WRITER_URL_HEADER}: ${writerHint}`);
      }
      socket.write(`${headers.join("\r\n")}\r\n\r\nRuntime writer required`);
      socket.destroy();
      return;
    }
    try {
      const host =
        req.headers.host ?? `${runtimePolicy.wsHost}:${runtimePolicy.wsPort}`;
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname !== TRPC_WS_PATH) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (runtimePolicy.authRequireCloudflareAccess) {
      const authCheck = validateCloudflareAccessHandshakeAuth(
        req.headers,
        toCloudflareAccessHandshakePolicy(runtimePolicy)
      );
      if (!authCheck.ok) {
        logger.warn(
          "Rejected WebSocket handshake without Cloudflare Access auth",
          {
            path: req.url ?? TRPC_WS_PATH,
            remoteAddress: req.socket.remoteAddress,
            reason: authCheck.reason ?? "unknown",
          }
        );
        socket.write(
          "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCloudflare Access authentication required"
        );
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const wsHandler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: ({ req, info }) =>
      createTrpcContext(trpcDeps, {
        req: {
          headers: req.headers,
          url: req.url,
          remoteAddress: req.socket.remoteAddress,
        },
        connectionParams: info.connectionParams,
      }),
  });

  server.listen(runtimePolicy.wsPort, runtimePolicy.wsHost);

  logger.info("HTTP + WebSocket server started", {
    host: runtimePolicy.wsHost,
    port: runtimePolicy.wsPort,
    trpcWsPath: TRPC_WS_PATH,
  });

  let processExitScheduled = false;
  let shutdownPromise: Promise<void> | null = null;
  let fatalShutdownTriggered = false;
  const requestProcessExit = (code: number) => {
    if (processExitScheduled) {
      return;
    }
    processExitScheduled = true;
    process.exit(code);
  };

  const closeWebSocketServer = () =>
    new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });

  const closeHttpServer = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

  const gracefulShutdown = (signal: "SIGTERM" | "SIGINT") => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = withTimeout(
      (async () => {
        const shutdownState: ShutdownTaskState = { firstError: null };
        wsHandler.broadcastReconnectNotification();
        await runShutdownStep(shutdownState, () =>
          deps.lifecycle.shutdown(signal)
        );
        await runShutdownStep(shutdownState, () => composition.dispose());
        await runShutdownStep(shutdownState, () => closeWebSocketServer());
        await runShutdownStep(shutdownState, () => closeHttpServer());
        await runShutdownStep(shutdownState, () => deps.logStore.flush());
        if (shutdownState.firstError) {
          throw shutdownState.firstError;
        }
      })(),
      SHUTDOWN_FORCE_EXIT_TIMEOUT_MS,
      `Graceful shutdown timed out after ${SHUTDOWN_FORCE_EXIT_TIMEOUT_MS}ms`
    );

    return shutdownPromise;
  };

  const handleFatalError = (label: string, cause: unknown) => {
    if (fatalShutdownTriggered) {
      return;
    }
    fatalShutdownTriggered = true;
    const error =
      cause instanceof Error ? cause : new Error(String(cause ?? label));
    logger.error(`Fatal runtime error: ${label}`, error);
    gracefulShutdown("SIGTERM")
      .catch((shutdownError) => {
        logger.error(
          `Graceful shutdown failed after fatal ${label}`,
          shutdownError as Error
        );
      })
      .finally(() => {
        requestProcessExit(1);
      });
  };

  process.on("SIGTERM", () => {
    gracefulShutdown("SIGTERM")
      .then(() => {
        requestProcessExit(0);
      })
      .catch((error) => {
        logger.error("Graceful shutdown failed after SIGTERM", error as Error);
        requestProcessExit(1);
      });
  });
  process.on("SIGINT", () => {
    gracefulShutdown("SIGINT")
      .then(() => {
        requestProcessExit(0);
      })
      .catch((error) => {
        logger.error("Graceful shutdown failed after SIGINT", error as Error);
        requestProcessExit(1);
      });
  });
  process.on("uncaughtException", (error) => {
    handleFatalError("uncaughtException", error);
  });
  process.on("unhandledRejection", (reason) => {
    handleFatalError("unhandledRejection", reason);
  });

  return { server, wsHandler };
}
