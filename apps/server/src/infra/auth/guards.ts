import { auth } from "./auth";

type HeaderRecord = Record<string, string | string[] | undefined>;

interface RequestLike {
  headers: Headers | HeaderRecord;
  url?: string;
}

const API_KEY_QUERY_PARAMS = ["apiKey", "api_key", "apikey"] as const;

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

export interface SessionUser {
  id: string;
  username?: string;
  email?: string;
  name?: string;
}

export async function getSessionFromRequest(
  req: RequestLike
): Promise<{ user: SessionUser; session: unknown } | null> {
  const headers = normalizeHeaders(req.headers);
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return null;
  }
  const sessionData = session as {
    user?: SessionUser;
    session?: unknown;
  };
  if (!sessionData.user?.id) {
    console.warn("[Auth] Session missing user id");
    return null;
  }
  console.debug(
    `[Auth] getSessionFromRequest: session found for user=${sessionData.user.username}`
  );
  return { user: sessionData.user, session: sessionData.session };
}

export async function getAuthContext(
  req?: RequestLike
): Promise<AuthContext | null> {
  if (!req) {
    return null;
  }

  const headers = normalizeHeaders(req.headers);
  const session = await auth.api.getSession({ headers });
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
      console.warn("[Auth] API key in query parameters is not allowed");
    }
    return null;
  }

  return await getAuthContextFromApiKey(apiKeyFromHeader);
}

export async function getAuthContextFromApiKey(
  apiKey: string
): Promise<AuthContext | null> {
  try {
    const result = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!(result?.valid && result.key?.userId)) {
      return null;
    }
    return { type: "apiKey", userId: result.key.userId };
  } catch (error) {
    console.error("Failed to verify API key:", error);
    return null;
  }
}
