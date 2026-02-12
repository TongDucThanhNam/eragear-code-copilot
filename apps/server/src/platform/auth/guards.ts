import { createLogger } from "../logging/structured-logger";

const logger = createLogger("Auth");

type HeaderRecord = Record<string, string | string[] | undefined>;

interface RequestLike {
  headers: Headers | HeaderRecord;
  url?: string;
}

interface AuthApiService {
  api: {
    getSession(input: { headers: Headers }): Promise<unknown>;
    verifyApiKey(input: { body: { key: string } }): Promise<unknown>;
  };
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
  username?: string | null;
  email?: string | null;
  name?: string | null;
}

async function getSessionFromRequestWithAuth(
  authService: AuthApiService,
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
  const session = (await authService.api.getSession({ headers })) as
    | {
        user?: {
          id?: string;
        };
        session?: unknown;
      }
    | undefined
    | null;
  if (session) {
    if (!session.user?.id) {
      return null;
    }
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
