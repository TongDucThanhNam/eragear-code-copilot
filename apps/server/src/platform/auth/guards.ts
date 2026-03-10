import { createHash } from "node:crypto";
import { ENV } from "@/config/environment";
import { createLogger } from "../logging/structured-logger";

const logger = createLogger("Auth");
const SESSION_TOKEN_COOKIE_NAME = "better-auth.session_token";
const AUTH_RESOLUTION_RATE_LIMIT_MAX_TRACKED_KEYS = 20_000;
const MIN_AUTH_RESOLUTION_RATE_LIMIT_WINDOW_MS = 1000;
const AUTH_RESOLUTION_OVERFLOW_BUCKET_KEY = "__overflow__";
const INTERNAL_REMOTE_ADDRESS_HEADER = "x-eragear-remote-address";

type HeaderRecord = Record<string, string | string[] | undefined>;

interface RequestLike {
  headers: Headers | HeaderRecord;
  url?: string;
  remoteAddress?: string;
}

interface AuthApiService {
  api: {
    getSession(input: { headers: Headers }): Promise<unknown>;
    verifyApiKey(input: { body: { key: string } }): Promise<unknown>;
  };
}

const API_KEY_QUERY_PARAMS = ["apiKey", "api_key", "apikey"] as const;
const authResolutionRateBuckets = new Map<
  string,
  {
    windowStartedAtMs: number;
    count: number;
  }
>();
let lastAuthResolutionPruneAtMs = 0;
let hasWarnedAboutOverflow = false;

export interface AuthContext {
  type: "session" | "apiKey";
  userId: string;
  user?: unknown;
  session?: unknown;
}

function normalizeHeaders(headers: Headers | HeaderRecord): Headers {
  if (headers instanceof Headers) {
    return headers;
  }

  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized.set(key, value.join(","));
      continue;
    }
    if (value !== undefined) {
      normalized.set(key, value);
    }
  }
  return normalized;
}

function extractApiKeyFromHeaders(headers: Headers): string | null {
  const direct = headers.get("x-api-key") ?? headers.get("x-api_key");
  if (direct && direct.trim().length > 0) {
    return direct.trim();
  }

  const authHeader = headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (!(scheme && token)) {
    return null;
  }

  const normalized = scheme.toLowerCase();
  if (
    normalized === "bearer" ||
    normalized === "apikey" ||
    normalized === "api-key"
  ) {
    return token.trim();
  }

  return null;
}

function hasDeprecatedApiKeyQuery(url?: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, "http://localhost");
    return API_KEY_QUERY_PARAMS.some((param) => parsed.searchParams.has(param));
  } catch {
    return false;
  }
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeIpAddress(
  rawValue: string | null | undefined
): string | null {
  if (!rawValue) {
    return null;
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("::ffff:")) {
    const mapped = trimmed.slice("::ffff:".length).trim();
    return mapped.length > 0 ? mapped : null;
  }
  return trimmed;
}

function getTrustedProxyIpSet(): Set<string> {
  return new Set(
    ENV.authTrustedProxyIps
      .map((ip) => normalizeIpAddress(ip))
      .filter((ip): ip is string => ip !== null)
  );
}

function extractSessionTokenFromCookie(headers: Headers): string | null {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [namePart, ...valueParts] = cookie.trim().split("=");
    if (namePart !== SESSION_TOKEN_COOKIE_NAME) {
      continue;
    }
    const token = valueParts.join("=").trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

function resolveRemoteAddress(
  req: RequestLike,
  headers: Headers
): string | null {
  return normalizeIpAddress(
    req.remoteAddress ?? headers.get(INTERNAL_REMOTE_ADDRESS_HEADER)
  );
}

function extractClientAddress(
  req: RequestLike,
  headers: Headers
): string | null {
  const remoteAddress = resolveRemoteAddress(req, headers);
  if (!remoteAddress) {
    return null;
  }
  if (!getTrustedProxyIpSet().has(remoteAddress)) {
    return remoteAddress;
  }

  const forwardedAddress =
    normalizeIpAddress(headers.get("cf-connecting-ip")) ??
    normalizeIpAddress(headers.get("x-real-ip")) ??
    normalizeIpAddress(headers.get("x-forwarded-for")?.split(",")[0]);
  if (forwardedAddress) {
    return forwardedAddress;
  }
  return remoteAddress;
}

function buildAuthResolutionRateLimitKey(params: {
  req: RequestLike;
  headers: Headers;
}): {
  key: string;
  keyType:
    | "api"
    | "session"
    | "ip"
    | "authorization"
    | "anonymous"
    | "overflow";
} {
  const { req, headers } = params;
  const apiKey = extractApiKeyFromHeaders(headers);
  if (apiKey) {
    return { key: `api:${hashToken(apiKey)}`, keyType: "api" };
  }

  const sessionToken = extractSessionTokenFromCookie(headers);
  if (sessionToken) {
    return { key: `session:${hashToken(sessionToken)}`, keyType: "session" };
  }

  const clientAddress = extractClientAddress(req, headers);
  if (clientAddress) {
    return { key: `ip:${clientAddress}`, keyType: "ip" };
  }

  const authorizationHeader = headers.get("authorization");
  if (authorizationHeader && authorizationHeader.trim().length > 0) {
    return {
      key: `authorization:${hashToken(authorizationHeader)}`,
      keyType: "authorization",
    };
  }

  return { key: "anonymous", keyType: "anonymous" };
}

function pruneAuthResolutionRateBuckets(nowMs: number, windowMs: number): void {
  if (nowMs - lastAuthResolutionPruneAtMs < windowMs) {
    return;
  }
  lastAuthResolutionPruneAtMs = nowMs;
  for (const [key, bucket] of authResolutionRateBuckets) {
    if (nowMs - bucket.windowStartedAtMs >= windowMs) {
      authResolutionRateBuckets.delete(key);
    }
  }
  // Reset overflow warning if we're back under the tracking threshold
  if (
    hasWarnedAboutOverflow &&
    authResolutionRateBuckets.size < AUTH_RESOLUTION_RATE_LIMIT_MAX_TRACKED_KEYS
  ) {
    hasWarnedAboutOverflow = false;
  }
}

function resolveRateLimitBucketKey(rateLimitKey: {
  key: string;
  keyType:
    | "api"
    | "session"
    | "ip"
    | "authorization"
    | "anonymous"
    | "overflow";
}): {
  key: string;
  keyType:
    | "api"
    | "session"
    | "ip"
    | "authorization"
    | "anonymous"
    | "overflow";
} {
  if (authResolutionRateBuckets.has(rateLimitKey.key)) {
    return rateLimitKey;
  }
  if (
    authResolutionRateBuckets.size < AUTH_RESOLUTION_RATE_LIMIT_MAX_TRACKED_KEYS
  ) {
    return rateLimitKey;
  }
  if (!hasWarnedAboutOverflow) {
    hasWarnedAboutOverflow = true;
    logger.warn(
      "Auth rate limit bucket overflow: too many tracked keys, using shared overflow bucket",
      {
        trackedKeys: authResolutionRateBuckets.size,
        maxTrackedKeys: AUTH_RESOLUTION_RATE_LIMIT_MAX_TRACKED_KEYS,
      }
    );
  }
  return {
    key: AUTH_RESOLUTION_OVERFLOW_BUCKET_KEY,
    keyType: "overflow",
  };
}

function consumeAuthResolutionRateLimit(req: RequestLike): boolean {
  if (!ENV.authApiKeyRateLimitEnabled) {
    return true;
  }

  const maxRequests = Math.max(
    1,
    Math.trunc(ENV.authApiKeyRateLimitMaxRequests)
  );
  const windowMs = Math.max(
    MIN_AUTH_RESOLUTION_RATE_LIMIT_WINDOW_MS,
    Math.trunc(ENV.authApiKeyRateLimitTimeWindowMs)
  );
  const nowMs = Date.now();
  pruneAuthResolutionRateBuckets(nowMs, windowMs);
  const headers = normalizeHeaders(req.headers);
  const rateLimitKey = resolveRateLimitBucketKey(
    buildAuthResolutionRateLimitKey({ req, headers })
  );

  const bucket = authResolutionRateBuckets.get(rateLimitKey.key);
  if (!bucket || nowMs - bucket.windowStartedAtMs >= windowMs) {
    authResolutionRateBuckets.set(rateLimitKey.key, {
      windowStartedAtMs: nowMs,
      count: 1,
    });
    return true;
  }

  // Apply stricter limits for anonymous/overflow buckets to prevent
  // a single source from exhausting the shared rate-limit bucket
  const effectiveMaxRequests =
    rateLimitKey.keyType === "anonymous" || rateLimitKey.keyType === "overflow"
      ? Math.max(1, Math.floor(maxRequests / 30))
      : maxRequests;

  if (bucket.count >= effectiveMaxRequests) {
    logger.warn("Auth resolution rate limit exceeded", {
      keyType: rateLimitKey.keyType,
      windowMs,
      maxRequests: effectiveMaxRequests,
    });
    return false;
  }

  bucket.count += 1;
  return true;
}

export interface SessionUser {
  id: string;
  username?: string | null;
  email?: string | null;
  name?: string | null;
}

async function getSessionFromRequestWithAuth(
  authService: AuthApiService,
  req: RequestLike,
  options?: { rateLimitAlreadyConsumed?: boolean }
): Promise<{ user: SessionUser; session: unknown } | null> {
  if (
    !(options?.rateLimitAlreadyConsumed || consumeAuthResolutionRateLimit(req))
  ) {
    return null;
  }
  const headers = normalizeHeaders(req.headers);
  const session = (await authService.api.getSession({ headers })) as
    | {
        user?: SessionUser;
        session?: unknown;
      }
    | undefined
    | null;
  if (!session) {
    return null;
  }
  const sessionData = session;
  if (!sessionData.user?.id) {
    logger.warn("Session missing user id");
    return null;
  }
  logger.debug("Session resolved from request", {
    username: sessionData.user.username,
  });
  return { user: sessionData.user, session: sessionData.session };
}

async function getAuthContextFromApiKeyWithAuth(
  authService: AuthApiService,
  apiKey: string
): Promise<AuthContext | null> {
  try {
    const result = (await authService.api.verifyApiKey({
      body: { key: apiKey },
    })) as
      | {
          valid?: boolean;
          key?: { userId?: string };
        }
      | undefined
      | null;
    if (!(result?.valid && result.key?.userId)) {
      return null;
    }
    return { type: "apiKey", userId: result.key.userId };
  } catch (error) {
    logger.error("Failed to verify API key", error as Error);
    return null;
  }
}

async function getAuthContextWithAuth(
  authService: AuthApiService,
  req?: RequestLike
): Promise<AuthContext | null> {
  if (!req) {
    return null;
  }

  const headers = normalizeHeaders(req.headers);
  if (!consumeAuthResolutionRateLimit(req)) {
    return null;
  }
  const session = await getSessionFromRequestWithAuth(authService, req, {
    rateLimitAlreadyConsumed: true,
  });
  if (session) {
    return {
      type: "session",
      userId: session.user.id,
      user: session.user,
      session: session.session,
    };
  }

  const apiKeyFromHeader = extractApiKeyFromHeaders(headers);
  if (!apiKeyFromHeader) {
    if (hasDeprecatedApiKeyQuery(req.url)) {
      logger.warn("API key in query parameters is not allowed");
    }
    return null;
  }

  return await getAuthContextFromApiKeyWithAuth(authService, apiKeyFromHeader);
}

export function createSessionResolver(authService: AuthApiService) {
  return async (
    req: RequestLike
  ): Promise<{ user: SessionUser; session: unknown } | null> => {
    return await getSessionFromRequestWithAuth(authService, req);
  };
}

export function createAuthContextResolver(authService: AuthApiService) {
  return async (req?: RequestLike): Promise<AuthContext | null> => {
    return await getAuthContextWithAuth(authService, req);
  };
}

/**
 * Check if request headers contain any authentication credentials
 * (session cookie or API key in headers). Used by the WS upgrade handler
 * to decide whether to verify credentials before accepting the connection.
 */
export function hasAuthCredentialsInHeaders(
  headers: Headers | Record<string, string | string[] | undefined>
): boolean {
  const normalized = normalizeHeaders(headers);
  if (extractSessionTokenFromCookie(normalized)) {
    return true;
  }
  if (extractApiKeyFromHeaders(normalized)) {
    return true;
  }
  return false;
}

export function resetAuthResolutionRateLimitForTests(): void {
  authResolutionRateBuckets.clear();
  lastAuthResolutionPruneAtMs = 0;
  hasWarnedAboutOverflow = false;
}
