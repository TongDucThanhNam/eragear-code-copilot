import { toError } from "@/shared/utils/error.util";

export interface AuthBootstrapRequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
}

interface UserScopedAuthContext {
  userId: string;
}

export interface AuthContextBootstrapDependencies<TAuthContext> {
  resolveAuthContext: (
    req: AuthBootstrapRequestLike
  ) => Promise<TAuthContext | null>;
  ensureUserDefaults: (userId: string) => Promise<void>;
  onEnsureUserDefaultsError?: (input: {
    userId: string;
    error: Error;
  }) => void | Promise<void>;
}

export interface AuthContextBootstrapPolicy {
  ensureUserDefaultsTtlMs: number;
  cacheMaxUsers?: number;
  inFlightMaxUsers?: number;
  now?: () => number;
}

const MIN_ENSURE_DEFAULTS_TTL_MS = 1000;
const DEFAULT_CACHE_MAX_USERS = 10_000;
const DEFAULT_INFLIGHT_MAX_USERS = 2000;

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    throw new Error(
      "[AuthBootstrap] Auth resolver returned an empty userId for authenticated request"
    );
  }
  return normalized;
}

function normalizeEnsureDefaultsTtlMs(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return MIN_ENSURE_DEFAULTS_TTL_MS;
  }
  return Math.max(MIN_ENSURE_DEFAULTS_TTL_MS, Math.trunc(ttlMs));
}

function normalizeMaxUsers(
  limit: number | undefined,
  fallback: number
): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.max(1, Math.trunc(limit));
}

export async function resolveAuthContextWithBootstrap<
  TAuthContext extends UserScopedAuthContext,
>(
  deps: AuthContextBootstrapDependencies<TAuthContext>,
  req: AuthBootstrapRequestLike
): Promise<TAuthContext | null> {
  const authContext = await deps.resolveAuthContext(req);
  if (!authContext) {
    return null;
  }
  await deps.ensureUserDefaults(authContext.userId);
  return authContext;
}

export function createAuthContextResolverWithBootstrap<
  TAuthContext extends UserScopedAuthContext,
>(
  deps: AuthContextBootstrapDependencies<TAuthContext>,
  policy: AuthContextBootstrapPolicy
) {
  const now = policy.now ?? Date.now;
  const ttlMs = normalizeEnsureDefaultsTtlMs(policy.ensureUserDefaultsTtlMs);
  const cacheMaxUsers = normalizeMaxUsers(
    policy.cacheMaxUsers,
    DEFAULT_CACHE_MAX_USERS
  );
  const inFlightMaxUsers = normalizeMaxUsers(
    policy.inFlightMaxUsers,
    DEFAULT_INFLIGHT_MAX_USERS
  );
  const cacheByUserId = new Map<string, number>();
  const inFlightByUserId = new Map<string, Promise<void>>();
  let lastCachePruneAt = 0;

  const pruneExpiredCache = (nowMs: number, force = false) => {
    if (!force && nowMs - lastCachePruneAt < ttlMs) {
      return;
    }
    lastCachePruneAt = nowMs;
    for (const [userId, expiresAt] of cacheByUserId) {
      if (expiresAt <= nowMs) {
        cacheByUserId.delete(userId);
      }
    }
  };

  const enforceCacheCapacity = (nowMs: number, reserveSlots: number) => {
    if (cacheByUserId.size + reserveSlots <= cacheMaxUsers) {
      return;
    }

    pruneExpiredCache(nowMs, true);
    while (cacheByUserId.size + reserveSlots > cacheMaxUsers) {
      const oldestUserId = cacheByUserId.keys().next().value;
      if (typeof oldestUserId !== "string") {
        break;
      }
      cacheByUserId.delete(oldestUserId);
    }
  };

  const runEnsureDefaults = async (userId: string) => {
    try {
      await deps.ensureUserDefaults(userId);
      const nowMs = now();
      const reserveSlots = cacheByUserId.has(userId) ? 0 : 1;
      enforceCacheCapacity(nowMs, reserveSlots);
      const expiresAt = nowMs + ttlMs;
      cacheByUserId.delete(userId);
      cacheByUserId.set(userId, expiresAt);
    } catch (error) {
      const normalizedError = toError(error);
      try {
        await deps.onEnsureUserDefaultsError?.({
          userId,
          error: normalizedError,
        });
      } catch {
        // Ignore observability callback failures to keep auth resolution fail-open.
      }
    }
  };

  const ensureUserDefaultsWithCache = async (rawUserId: string) => {
    const userId = normalizeUserId(rawUserId);
    const nowMs = now();
    pruneExpiredCache(nowMs);
    const cachedUntil = cacheByUserId.get(userId);
    if (cachedUntil !== undefined && cachedUntil > nowMs) {
      cacheByUserId.delete(userId);
      cacheByUserId.set(userId, cachedUntil);
      return;
    }
    if (cachedUntil !== undefined) {
      cacheByUserId.delete(userId);
    }

    const inFlight = inFlightByUserId.get(userId);
    if (inFlight) {
      await inFlight;
      return;
    }

    if (inFlightByUserId.size >= inFlightMaxUsers) {
      await runEnsureDefaults(userId);
      return;
    }

    let currentTask: Promise<void> | undefined;
    currentTask = runEnsureDefaults(userId).finally(() => {
      if (inFlightByUserId.get(userId) === currentTask) {
        inFlightByUserId.delete(userId);
      }
    });
    inFlightByUserId.set(userId, currentTask);
    await currentTask;
  };

  return async (
    req: AuthBootstrapRequestLike
  ): Promise<TAuthContext | null> => {
    const authContext = await deps.resolveAuthContext(req);
    if (!authContext) {
      return null;
    }

    await ensureUserDefaultsWithCache(authContext.userId);
    return authContext;
  };
}
