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
}

export interface AuthContextBootstrapPolicy {
  ensureUserDefaultsTtlMs: number;
  now?: () => number;
}

const MIN_ENSURE_DEFAULTS_TTL_MS = 1_000;

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
  const cacheByUserId = new Map<string, number>();
  const inFlightByUserId = new Map<string, Promise<void>>();
  let lastCachePruneAt = 0;

  const pruneExpiredCache = (nowMs: number) => {
    if (nowMs - lastCachePruneAt < ttlMs) {
      return;
    }
    lastCachePruneAt = nowMs;
    for (const [userId, expiresAt] of cacheByUserId) {
      if (expiresAt <= nowMs) {
        cacheByUserId.delete(userId);
      }
    }
  };

  const ensureUserDefaultsWithCache = async (rawUserId: string) => {
    const userId = normalizeUserId(rawUserId);
    const nowMs = now();
    pruneExpiredCache(nowMs);
    const cachedUntil = cacheByUserId.get(userId);
    if (cachedUntil !== undefined && cachedUntil > nowMs) {
      return;
    }

    const inFlight = inFlightByUserId.get(userId);
    if (inFlight) {
      await inFlight;
      return;
    }

    let currentTask: Promise<void> | undefined;
    currentTask = deps
      .ensureUserDefaults(userId)
      .then(() => {
        cacheByUserId.set(userId, now() + ttlMs);
      })
      .finally(() => {
        if (inFlightByUserId.get(userId) === currentTask) {
          inFlightByUserId.delete(userId);
        }
      });
    inFlightByUserId.set(userId, currentTask);
    await currentTask;
  };

  return async (req: AuthBootstrapRequestLike): Promise<TAuthContext | null> => {
    const authContext = await deps.resolveAuthContext(req);
    if (!authContext) {
      return null;
    }

    await ensureUserDefaultsWithCache(authContext.userId);
    return authContext;
  };
}
