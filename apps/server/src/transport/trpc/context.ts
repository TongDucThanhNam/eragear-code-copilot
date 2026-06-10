/**
 * tRPC Context
 *
 * Creates the tRPC context from explicit service dependencies.
 * This context is passed to all tRPC procedures and routers.
 *
 * @module transport/trpc/context
 */

import type { AppConfigService } from "@/modules/settings";
import type { AppUseCases } from "@/modules/use-cases";

export interface RequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
}

type ConnectionParams = Record<string, unknown> | null;

const CONNECTION_PARAM_API_KEY_KEYS = ["apiKey", "api_key", "apikey"] as const;
const CONNECTION_PARAM_COOKIE_KEYS = ["cookie", "cookieHeader"] as const;
const CONNECTION_PARAM_LOCAL_AUTH_TOKEN_KEYS = [
  "eragearLocalToken",
  "localAuthToken",
  "local_auth_token",
] as const;
const LOCAL_AUTH_TOKEN_HEADER = "x-eragear-local-token";

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  key: string
): string | null {
  if (headers instanceof Headers) {
    const value = headers.get(key);
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }
  const value = headers[key];
  if (Array.isArray(value)) {
    const joined = value.join(",").trim();
    return joined.length > 0 ? joined : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function extractApiKeyFromConnectionParams(
  connectionParams?: ConnectionParams
): string | null {
  return extractTextConnectionParam(
    connectionParams,
    CONNECTION_PARAM_API_KEY_KEYS
  );
}

function extractCookieFromConnectionParams(
  connectionParams?: ConnectionParams
): string | null {
  return extractTextConnectionParam(
    connectionParams,
    CONNECTION_PARAM_COOKIE_KEYS
  );
}

function extractLocalAuthTokenFromConnectionParams(
  connectionParams?: ConnectionParams
): string | null {
  return extractTextConnectionParam(
    connectionParams,
    CONNECTION_PARAM_LOCAL_AUTH_TOKEN_KEYS
  );
}

function extractTextConnectionParam(
  connectionParams: ConnectionParams | undefined,
  keys: readonly string[]
): string | null {
  if (!connectionParams || typeof connectionParams !== "object") {
    return null;
  }
  for (const key of keys) {
    const value = connectionParams[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function withCookieHeader(req: RequestLike, cookie: string): RequestLike {
  if (getHeader(req.headers, "cookie") !== null) {
    return req;
  }

  if (req.headers instanceof Headers) {
    const nextHeaders = new Headers(req.headers);
    nextHeaders.set("cookie", cookie);
    return { ...req, headers: nextHeaders };
  }

  return {
    ...req,
    headers: {
      ...req.headers,
      cookie,
    },
  };
}

function withApiKeyHeader(req: RequestLike, apiKey: string): RequestLike {
  const hasAuthHeader =
    getHeader(req.headers, "x-api-key") !== null ||
    getHeader(req.headers, "x-api_key") !== null ||
    getHeader(req.headers, "authorization") !== null;
  if (hasAuthHeader) {
    return req;
  }

  if (req.headers instanceof Headers) {
    const nextHeaders = new Headers(req.headers);
    nextHeaders.set("x-api-key", apiKey);
    return { ...req, headers: nextHeaders };
  }

  return {
    ...req,
    headers: {
      ...req.headers,
      "x-api-key": apiKey,
    },
  };
}

function withLocalAuthTokenHeader(
  req: RequestLike,
  localAuthToken: string
): RequestLike {
  if (getHeader(req.headers, LOCAL_AUTH_TOKEN_HEADER) !== null) {
    return req;
  }

  if (req.headers instanceof Headers) {
    const nextHeaders = new Headers(req.headers);
    nextHeaders.set(LOCAL_AUTH_TOKEN_HEADER, localAuthToken);
    return { ...req, headers: nextHeaders };
  }

  return {
    ...req,
    headers: {
      ...req.headers,
      [LOCAL_AUTH_TOKEN_HEADER]: localAuthToken,
    },
  };
}

export interface AuthContext {
  type: "session" | "apiKey" | "local";
  userId: string;
  user?: unknown;
  session?: unknown;
}

export interface TrpcContextDependencies {
  useCases: AppUseCases;
  appConfig: AppConfigService;
  resolveAuthContext: (req: RequestLike) => Promise<AuthContext | null>;
}

/**
 * Creates a tRPC context containing explicit service dependencies.
 *
 * @param deps - App-level service dependencies
 * @param opts - Optional request and connection parameters
 * @returns Context object with service factories
 *
 * @example
 * ```typescript
 * const context = createTrpcContext(deps);
 * const projects = context.useCases.project.list.execute();
 * ```
 */
export async function createTrpcContext(
  deps: TrpcContextDependencies,
  opts?: { req?: RequestLike; connectionParams?: ConnectionParams }
) {
  const cookieFromConnectionParams = extractCookieFromConnectionParams(
    opts?.connectionParams
  );
  const apiKeyFromConnectionParams = extractApiKeyFromConnectionParams(
    opts?.connectionParams
  );
  const localAuthTokenFromConnectionParams =
    extractLocalAuthTokenFromConnectionParams(opts?.connectionParams);
  const requestWithCookie =
    opts?.req && cookieFromConnectionParams
      ? withCookieHeader(opts.req, cookieFromConnectionParams)
      : opts?.req;
  const requestWithLocalAuth =
    requestWithCookie && localAuthTokenFromConnectionParams
      ? withLocalAuthTokenHeader(
          requestWithCookie,
          localAuthTokenFromConnectionParams
        )
      : requestWithCookie;
  const requestWithAuth =
    requestWithLocalAuth && apiKeyFromConnectionParams
      ? withApiKeyHeader(requestWithLocalAuth, apiKeyFromConnectionParams)
      : requestWithLocalAuth;

  const authContext = requestWithAuth
    ? await deps.resolveAuthContext(requestWithAuth)
    : null;

  return {
    useCases: deps.useCases,
    appConfig: deps.appConfig,
    auth: authContext,
  };
}

/** Type representing the tRPC context */
export type TRPCContext = Awaited<ReturnType<typeof createTrpcContext>>;
