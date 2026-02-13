import { toError } from "@/shared/utils/error.util";

export interface AuthBootstrapRequestLike {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
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
const MAX_INFLIGHT_OVERFLOW_BACKOFF_MS = 5000;
const ENSURE_DEFAULTS_CAPACITY_ERROR_PREFIX =
  "[AuthBootstrap] ensureUserDefaults capacity exceeded";

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
  const inFlightOverflowBackoffMs = Math.max(
    250,
    Math.min(ttlMs, MAX_INFLIGHT_OVERFLOW_BACKOFF_MS)
  );
  const cacheByUserId = new Map<string, number>();
  const cacheExpiryQueue: Array<{ userId: string; expiresAt: number }> = [];
  let cacheExpiryCursor = 0;
  const inFlightByUserId = new Map<string, Promise<void>>();
  const inFlightOverflowBackoffByUserId = new Map<string, number>();
  const scheduledRetryByUserId = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  let lastCachePruneAt = 0;

  const isEnsureDefaultsCapacityError = (error: Error): boolean => {
    return error.message.includes(ENSURE_DEFAULTS_CAPACITY_ERROR_PREFIX);
  };

  const reportEnsureDefaultsError = async (userId: string, error: Error) => {
    try {
      await deps.onEnsureUserDefaultsError?.({
        userId,
        error,
      });
    } catch {
      // Observability callback failures must not hide bootstrap errors.
    }
  };

  const pruneExpiredCache = (nowMs: number, force = false) => {
    if (!force && nowMs - lastCachePruneAt < ttlMs) {
      return;
    }
    lastCachePruneAt = nowMs;
    while (cacheExpiryCursor < cacheExpiryQueue.length) {
      const entry = cacheExpiryQueue[cacheExpiryCursor];
      if (!entry || entry.expiresAt > nowMs) {
        break;
      }
      cacheExpiryCursor += 1;
      const currentExpiresAt = cacheByUserId.get(entry.userId);
      if (
        currentExpiresAt !== undefined &&
        currentExpiresAt <= nowMs &&
        currentExpiresAt === entry.expiresAt
      ) {
        cacheByUserId.delete(entry.userId);
      }
    }
    if (
      cacheExpiryCursor > 0 &&
      cacheExpiryCursor * 2 >= cacheExpiryQueue.length
    ) {
      cacheExpiryQueue.splice(0, cacheExpiryCursor);
      cacheExpiryCursor = 0;
    }
    for (const [userId, blockedUntil] of inFlightOverflowBackoffByUserId) {
      if (blockedUntil <= nowMs) {
        inFlightOverflowBackoffByUserId.delete(userId);
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
      cacheExpiryQueue.push({ userId, expiresAt });
      inFlightOverflowBackoffByUserId.delete(userId);
      const retryTimer = scheduledRetryByUserId.get(userId);
      if (retryTimer) {
        clearTimeout(retryTimer);
        scheduledRetryByUserId.delete(userId);
      }
    } catch (error) {
      const normalizedError = toError(error);
      await reportEnsureDefaultsError(userId, normalizedError);
      throw normalizedError;
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
      const blockedUntil = inFlightOverflowBackoffByUserId.get(userId);
      if (blockedUntil !== undefined && blockedUntil > nowMs) {
        throw new Error(
          `${ENSURE_DEFAULTS_CAPACITY_ERROR_PREFIX} for user ${userId}`
        );
      }
      inFlightOverflowBackoffByUserId.set(
        userId,
        nowMs + inFlightOverflowBackoffMs
      );
      throw new Error(
        `${ENSURE_DEFAULTS_CAPACITY_ERROR_PREFIX} for user ${userId}`
      );
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

  const scheduleEnsureDefaultsRetry = (userId: string) => {
    if (scheduledRetryByUserId.has(userId)) {
      return;
    }
    if (scheduledRetryByUserId.size >= inFlightMaxUsers) {
      return;
    }
    const timer = setTimeout(() => {
      scheduledRetryByUserId.delete(userId);
      ensureUserDefaultsWithCache(userId).catch(async (error) => {
        const normalizedError = toError(error);
        if (isEnsureDefaultsCapacityError(normalizedError)) {
          await reportEnsureDefaultsError(userId, normalizedError);
        }
        scheduleEnsureDefaultsRetry(userId);
      });
    }, inFlightOverflowBackoffMs);
    timer.unref?.();
    scheduledRetryByUserId.set(userId, timer);
  };

  return async (
    req: AuthBootstrapRequestLike
  ): Promise<TAuthContext | null> => {
    const authContext = await deps.resolveAuthContext(req);
    if (!authContext) {
      return null;
    }
    const normalizedUserId = normalizeUserId(authContext.userId);
    const normalizedAuthContext = {
      ...authContext,
      userId: normalizedUserId,
    } satisfies TAuthContext;

    try {
      await ensureUserDefaultsWithCache(normalizedUserId);
    } catch (error) {
      const normalizedError = toError(error);
      if (isEnsureDefaultsCapacityError(normalizedError)) {
        await reportEnsureDefaultsError(normalizedUserId, normalizedError);
      }
      scheduleEnsureDefaultsRetry(normalizedUserId);
      return normalizedAuthContext;
    }
    return normalizedAuthContext;
  };
}
