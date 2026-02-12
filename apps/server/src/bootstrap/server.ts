/**
 * Server Bootstrap Module
 *
 * Initializes and starts the HTTP and WebSocket servers.
 * Sets up the Hono web framework, tRPC router, and WebSocket handler for
 * real-time communication with the ACP client.
 *
 * @module bootstrap/server
 */

import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { reactRenderer } from "@hono/react-renderer";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createElement, Fragment } from "react";
import { WebSocketServer } from "ws";
import { ENV } from "../config/environment";
import { installConsoleLogger } from "../platform/logging/logger";
import { createRequestLogger } from "../platform/logging/request-logger";
import { createLogger } from "../platform/logging/structured-logger";
import { createAuthContextResolverWithBootstrap } from "../transport/auth/auth-context.bootstrap";
import { createCorsMiddlewares } from "../transport/http/cors-factory";
import { createErrorHandler } from "../transport/http/error-handler";
import { requestIdMiddleware } from "../transport/http/request-id";
import { registerHttpRoutes } from "../transport/http/routes";
import { registerDashboardUiRoutes } from "../transport/http/routes/dashboard";
import type { HttpRouteDependencies } from "../transport/http/routes/deps";
import { applyFetchHeadersToNodeResponse } from "../transport/http/utils/response-headers";
import {
  createTrpcContext,
  type TrpcContextDependencies,
} from "../transport/trpc/context";
import { appRouter } from "../transport/trpc/router";
import {
  type AppComposition,
  type AppDependencies,
  createAppCompositionFromSettings,
} from "./composition";

const logger = createLogger("Server");
const SHUTDOWN_FORCE_EXIT_TIMEOUT_MS = 15_000;

export interface ServerRuntimePolicy {
  wsHost: string;
  wsPort: number;
  wsMaxPayloadBytes: number;
  corsStrictOrigin: boolean;
  authAllowSignup: boolean;
  isDev: boolean;
  defaultAdminUsername: string;
}

function createHttpRouteDependencies(
  deps: AppDependencies,
  runtimePolicy: ServerRuntimePolicy,
  resolveAuthContext: HttpRouteDependencies["resolveAuthContext"]
): HttpRouteDependencies {
  return {
    sessionServices: deps.sessionServices,
    projectServices: deps.projectServices,
    agentServices: deps.agentServices,
    settingsServices: deps.settingsServices,
    appConfig: deps.appConfig,
    opsServices: deps.opsServices,
    eventBus: deps.eventBus,
    logStore: deps.logStore,
    logger: deps.appLogger,
    auth: deps.auth,
    authState: deps.authRuntime.authState,
    runtime: {
      isDev: runtimePolicy.isDev,
      defaultAdminUsername: runtimePolicy.defaultAdminUsername,
    },
    resolveAuthContext,
  };
}

function createTrpcContextDependencies(
  deps: AppDependencies,
  resolveAuthContext: TrpcContextDependencies["resolveAuthContext"]
): TrpcContextDependencies {
  return {
    sessionServices: deps.sessionServices,
    aiServices: deps.aiServices,
    projectServices: deps.projectServices,
    agentServices: deps.agentServices,
    toolingServices: deps.toolingServices,
    settingsServices: deps.settingsServices,
    authServices: deps.authServices,
    appConfig: deps.appConfig,
    resolveAuthContext,
  };
}

function createBootstrappedAuthResolver(deps: AppDependencies) {
  return createAuthContextResolverWithBootstrap(
    {
      resolveAuthContext: deps.resolveAuthContext,
      ensureUserDefaults: async (userId) => {
        await deps.agentServices.ensureAgentDefaults().execute(userId);
      },
      onEnsureUserDefaultsError: ({ userId, error }) => {
        logger.warn("Failed to ensure user defaults during auth bootstrap", {
          userId,
          error: error.message,
        });
      },
    },
    {
      ensureUserDefaultsTtlMs: ENV.authBootstrapEnsureDefaultsTtlMs,
    }
  );
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

  if (typeof fromWeb === "function") {
    const stream = fromWeb(body as unknown as ReadableStream);
    try {
      await pipeline(stream as NodeJS.ReadableStream, res);
    } catch (error) {
      logger.warn("Failed to stream HTTP response body", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!(res.writableEnded || res.destroyed)) {
        res.end();
      }
    }
    return;
  }

  // Fallback: manual chunk reading (for older Node versions)
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        const chunk = Buffer.from(value);
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    }
  } catch (error) {
    logger.warn("Failed to read HTTP response stream", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    reader.releaseLock();
    if (!(res.writableEnded || res.destroyed)) {
      res.end();
    }
  }
}

/**
 * Creates the Hono application with all middleware and routes
 *
 * @returns Configured Hono application instance
 */
export async function createApp(
  composition?: AppComposition,
  resolveAuthContextOverride?: HttpRouteDependencies["resolveAuthContext"]
) {
  const resolvedComposition =
    composition ?? (await createAppCompositionFromSettings());
  const runtimePolicy = resolvedComposition.runtimePolicy;
  const deps = resolvedComposition.deps;
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
    if (
      c.req.path.startsWith("/api/auth") ||
      c.req.path.startsWith("/api/health")
    ) {
      return next();
    }
    return corsMiddleware.api(c, next);
  });

  app.all("/api/auth/*", async (c) => {
    const path = c.req.path;
    const isSignup = path.startsWith("/api/auth/sign-up");
    const isUsernameAvailability = path.startsWith(
      "/api/auth/is-username-available"
    );

    if (path === "/api/auth/api-key/verify" && c.req.method === "POST") {
      try {
        const body = await c.req.json();
        const result = await authRuntime.auth.api.verifyApiKey({
          body,
        });
        return c.json(result);
      } catch (error) {
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

  // Protect API routes (except /api/auth)
  app.use("/api/*", async (c, next) => {
    if (
      c.req.path.startsWith("/api/auth") ||
      c.req.path.startsWith("/api/health")
    ) {
      return next();
    }
    const authContext = await resolveAuthContext({
      headers: c.req.raw.headers,
      url: c.req.raw.url,
    });
    if (!authContext) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  // Register HTTP routes
  const api = new Hono();
  registerHttpRoutes(api, httpDeps);
  app.route("/api", api);
  registerDashboardUiRoutes(app, httpDeps);

  // Explicit 404 handler for better UX
  app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

  // Error handler for unhandled exceptions
  app.onError(createErrorHandler());

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
  const app = await createApp(composition, resolveAuthContext);
  deps.lifecycle.startBackground();

  const server = createServer(async (req, res) => {
    const host =
      req.headers.host ?? `${runtimePolicy.wsHost}:${runtimePolicy.wsPort}`;
    const url = new URL(req.url ?? "/", `http://${host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(","));
      } else if (value !== undefined) {
        headers.set(key, value);
      }
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
    const request = new Request(url, requestInit);

    const response = await app.fetch(request);
    res.statusCode = response.status;
    applyFetchHeadersToNodeResponse(res, response.headers);

    if (req.method === "HEAD" || response.status === 204) {
      res.end();
      return;
    }

    await pipeResponseBody(res, response);
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: runtimePolicy.wsMaxPayloadBytes,
  });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const wsHandler = applyWSSHandler({
    wss,
    router: appRouter,
    createContext: ({ req }) =>
      createTrpcContext(trpcDeps, {
        req,
      }),
  });

  server.listen(runtimePolicy.wsPort, runtimePolicy.wsHost);

  logger.info("HTTP + WebSocket server started", {
    host: runtimePolicy.wsHost,
    port: runtimePolicy.wsPort,
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

  const withTimeout = async <T>(
    work: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      timeoutHandle.unref?.();
    });

    try {
      return await Promise.race([work, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
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
        wsHandler.broadcastReconnectNotification();
        await deps.lifecycle.shutdown(signal);
        await closeWebSocketServer();
        await closeHttpServer();
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
