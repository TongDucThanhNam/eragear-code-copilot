import { ENV } from "#runtime/config/environment";
import type { AuthContext } from "#runtime/platform/auth/guards";
import { LOCAL_DESKTOP_USER_ID } from "#runtime/platform/auth/local-desktop-user";
import { createLogger } from "#runtime/platform/logging/structured-logger";
import { createAuthContextResolverWithBootstrap } from "#runtime/transport/auth/auth-context.bootstrap";
import type { HttpRouteDependencies } from "#runtime/transport/http/routes/deps";
import type {
  RequestLike,
  TrpcContextDependencies,
} from "#runtime/transport/trpc/context";
import type { AppDependencies } from "./composition";
import type { ServerRuntimePolicy } from "./server-runtime-policy";

const logger = createLogger("Server");
const LOCAL_AUTH_TOKEN_HEADER = "x-eragear-local-token";
const INTERNAL_REMOTE_ADDRESS_HEADER = "x-eragear-remote-address";

function getHeader(req: RequestLike, key: string): string | null {
  if (req.headers instanceof Headers) {
    const value = req.headers.get(key);
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  const direct = req.headers[key];
  if (Array.isArray(direct)) {
    const joined = direct.join(",").trim();
    return joined.length > 0 ? joined : null;
  }
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const lowerKey = key.toLowerCase();
  const lower = req.headers[lowerKey];
  if (Array.isArray(lower)) {
    const joined = lower.join(",").trim();
    return joined.length > 0 ? joined : null;
  }
  if (typeof lower === "string" && lower.trim().length > 0) {
    return lower.trim();
  }

  return null;
}

function normalizeIpAddress(
  rawValue: string | null | undefined
): string | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice("::ffff:".length);
  }
  return trimmed;
}

function isLoopbackAddress(rawValue: string | null | undefined): boolean {
  const normalized = normalizeIpAddress(rawValue);
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function resolveLocalDesktopAuthContext(req?: RequestLike): AuthContext | null {
  if (!(ENV.localAuthEnabled && ENV.localAuthToken && req)) {
    return null;
  }

  const providedToken = getHeader(req, LOCAL_AUTH_TOKEN_HEADER);
  if (providedToken !== ENV.localAuthToken) {
    return null;
  }

  const remoteAddress =
    req.remoteAddress ?? getHeader(req, INTERNAL_REMOTE_ADDRESS_HEADER);
  if (!isLoopbackAddress(remoteAddress)) {
    logger.warn("Rejected local desktop auth token from non-loopback address", {
      remoteAddress: remoteAddress ?? "unknown",
    });
    return null;
  }

  return {
    type: "local",
    userId: LOCAL_DESKTOP_USER_ID,
    user: {
      id: LOCAL_DESKTOP_USER_ID,
      email: null,
      username: "local",
      name: "Local Desktop",
      image: null,
    },
  };
}

export function createHttpRouteDependencies(
  deps: AppDependencies,
  runtimePolicy: ServerRuntimePolicy,
  resolveAuthContext: HttpRouteDependencies["resolveAuthContext"]
): HttpRouteDependencies {
  return {
    useCases: deps.useCases,
    appConfig: deps.appConfig,
    eventBus: deps.eventBus,
    logStore: deps.logStore,
    logger: deps.appLogger,
    auth: deps.auth,
    authState: deps.authRuntime.authState,
    runtime: {
      isDev: runtimePolicy.isDev,
      defaultAdminUsername: runtimePolicy.defaultAdminUsername,
      httpMaxBodyBytes: runtimePolicy.httpMaxBodyBytes,
    },
    resolveAuthContext,
  };
}

export function createTrpcContextDependencies(
  deps: AppDependencies,
  resolveAuthContext: TrpcContextDependencies["resolveAuthContext"]
): TrpcContextDependencies {
  return {
    useCases: deps.useCases,
    appConfig: deps.appConfig,
    resolveAuthContext,
  };
}

export function createBootstrappedAuthResolver(deps: AppDependencies) {
  return createAuthContextResolverWithBootstrap(
    {
      resolveAuthContext: async (req) =>
        resolveLocalDesktopAuthContext(req) ?? deps.resolveAuthContext(req),
      ensureUserDefaults: async (userId) => {
        await deps.useCases.agent.ensureDefaults.execute(userId);
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
      cacheMaxUsers: ENV.authBootstrapCacheMaxUsers,
      inFlightMaxUsers: ENV.authBootstrapInFlightMaxUsers,
    }
  );
}
