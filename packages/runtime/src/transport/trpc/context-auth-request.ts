export interface RequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
}

export type ConnectionParams = Record<string, unknown> | null;

const CONNECTION_PARAM_API_KEY_KEYS = ["apiKey", "api_key", "apikey"] as const;
const CONNECTION_PARAM_COOKIE_KEYS = ["cookie", "cookieHeader"] as const;
const CONNECTION_PARAM_LOCAL_AUTH_TOKEN_KEYS = [
  "eragearLocalToken",
  "localAuthToken",
  "local_auth_token",
] as const;
const LOCAL_AUTH_TOKEN_HEADER = "x-eragear-local-token";

export function createTrpcAuthRequest(
  req: RequestLike | undefined,
  connectionParams?: ConnectionParams
): RequestLike | undefined {
  if (!req) {
    return undefined;
  }

  const cookieFromConnectionParams =
    extractCookieFromConnectionParams(connectionParams);
  const apiKeyFromConnectionParams =
    extractApiKeyFromConnectionParams(connectionParams);
  const localAuthTokenFromConnectionParams =
    extractLocalAuthTokenFromConnectionParams(connectionParams);

  const requestWithCookie = cookieFromConnectionParams
    ? withCookieHeader(req, cookieFromConnectionParams)
    : req;
  const requestWithLocalAuth = localAuthTokenFromConnectionParams
    ? withLocalAuthTokenHeader(
        requestWithCookie,
        localAuthTokenFromConnectionParams
      )
    : requestWithCookie;
  return apiKeyFromConnectionParams
    ? withApiKeyHeader(requestWithLocalAuth, apiKeyFromConnectionParams)
    : requestWithLocalAuth;
}

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
