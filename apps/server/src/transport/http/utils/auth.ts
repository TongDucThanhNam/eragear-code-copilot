/**
 * Transport HTTP Auth Utilities
 *
 * Client-facing auth helpers for HTTP routes.
 * Implements auth extraction directly from the route boundary.
 *
 * @module transport/http/utils/auth
 */

type HeaderRecord = Record<string, string | string[] | undefined>;

interface RequestLike {
  headers: Headers | HeaderRecord;
  url?: string;
}

export interface SessionUser {
  id: string;
  username?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface AuthContext {
  type: "session" | "apiKey";
  userId: string;
  user?: unknown;
  session?: unknown;
}

interface AuthService {
  api: {
    getSession(input: { headers: Headers }): Promise<unknown>;
    verifyApiKey(input: { body: { key: string } }): Promise<unknown>;
    listApiKeys(input: { headers: Headers }): Promise<unknown>;
    listDeviceSessions(input: { headers: Headers }): Promise<unknown>;
  };
}

const API_KEY_QUERY_PARAMS = ["apiKey", "api_key", "apikey"] as const;

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

/**
 * Get session from HTTP request
 * @param req - Request-like object with headers and URL
 * @returns User and session info or null if not authenticated
 */
export async function getSessionFromRequest(
  authService: AuthService,
  req: RequestLike
): Promise<{ user: SessionUser; session: unknown } | null> {
  const headers = normalizeHeaders(req.headers);
  const session = (await authService.api.getSession({ headers })) as
    | {
        user?: SessionUser;
        session?: unknown;
      }
    | undefined
    | null;
  if (!session?.user?.id) {
    return null;
  }
  return {
    user: session.user,
    session: session.session,
  };
}

export async function getAuthContextFromRequest(
  authService: AuthService,
  req: RequestLike
): Promise<AuthContext | null> {
  const headers = normalizeHeaders(req.headers);
  const session = (await authService.api.getSession({ headers })) as
    | {
        user?: {
          id?: string;
        };
        session?: unknown;
      }
    | undefined
    | null;

  if (session?.user?.id) {
    return {
      type: "session",
      userId: session.user.id,
      user: session.user,
      session: session.session,
    };
  }

  const apiKey = extractApiKeyFromHeaders(headers);
  if (!apiKey) {
    if (hasDeprecatedApiKeyQuery(req.url)) {
      return null;
    }
    return null;
  }

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
}

export async function listApiKeys(
  authService: AuthService,
  headers: Headers
): Promise<unknown[]> {
  const keys = await authService.api.listApiKeys({ headers });
  return Array.isArray(keys) ? keys : [];
}

export async function listDeviceSessions(
  authService: AuthService,
  headers: Headers
): Promise<unknown[]> {
  const sessions = await authService.api.listDeviceSessions({ headers });
  return Array.isArray(sessions) ? sessions : [];
}
