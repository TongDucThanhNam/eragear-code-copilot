import { ValidationError } from "#runtime/shared/errors";
import type { ClockPort } from "#runtime/shared/ports/clock.port";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type {
  ListProviderQuotasInput,
  ProviderQuotaListResult,
  ProviderQuotaSnapshot,
  QuotaProviderStatus,
  QuotaWindow,
  RefreshProviderQuotaInput,
} from "./contracts/quota.contract";
import type { QuotaCredentialResolverPort } from "./ports/quota-credential-resolver.port";
import type {
  QuotaAuthSource,
  QuotaProviderAdapter,
  QuotaProviderContext,
} from "./ports/quota-provider.port";
import {
  noopProviderQuotaNotifier,
  type ProviderQuotaNotifier,
} from "./provider-quota.notifier";

const DEFAULT_CACHE_TTL_MS = 2 * 60 * 1000;

interface ProviderQuotaServiceOptions {
  cacheTtlMs?: number;
}

interface CacheEntry {
  snapshot: ProviderQuotaSnapshot;
  expiresAtMs: number;
}

interface CollectOptions {
  providerId?: string;
  includeUnavailable?: boolean;
  force: boolean;
}

export class ProviderQuotaService {
  private readonly providerQuotaNotifier: ProviderQuotaNotifier;
  private readonly clock: ClockPort;
  private readonly logger: LoggerPort;
  private readonly adapters: QuotaProviderAdapter[];
  private readonly credentialResolver?: QuotaCredentialResolverPort;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ProviderQuotaSnapshot>>();

  constructor(
    params: {
      providerQuotaNotifier?: ProviderQuotaNotifier;
      clock: ClockPort;
      logger: LoggerPort;
      adapters: QuotaProviderAdapter[];
      credentialResolver?: QuotaCredentialResolverPort;
    },
    options: ProviderQuotaServiceOptions = {}
  ) {
    this.providerQuotaNotifier =
      params.providerQuotaNotifier ?? noopProviderQuotaNotifier;
    this.clock = params.clock;
    this.logger = params.logger;
    this.adapters = [...params.adapters];
    this.credentialResolver = params.credentialResolver;
    this.cacheTtlMs = Math.max(1, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  }

  async list(
    userId: string,
    input?: ListProviderQuotasInput
  ): Promise<ProviderQuotaListResult> {
    return await this.collect(userId, {
      providerId: input?.providerId,
      includeUnavailable: input?.includeUnavailable,
      force: Boolean(input?.refresh),
    });
  }

  async refresh(
    userId: string,
    input?: RefreshProviderQuotaInput
  ): Promise<ProviderQuotaListResult> {
    return await this.collect(userId, {
      providerId: input?.providerId,
      includeUnavailable: input?.includeUnavailable,
      force: input?.force !== false,
    });
  }

  private async collect(
    userId: string,
    options: CollectOptions
  ): Promise<ProviderQuotaListResult> {
    const checkedAt = new Date(this.clock.nowMs()).toISOString();
    const ctx: QuotaProviderContext = {
      userId,
      now: new Date(this.clock.nowMs()),
      credentialResolver: this.credentialResolver,
    };
    const adapters = this.selectAdapters(options);
    const snapshots = await Promise.all(
      adapters.map((adapter) =>
        this.getSnapshot(userId, adapter, ctx, options.force)
      )
    );
    const providers =
      options.providerId || options.includeUnavailable
        ? snapshots
        : snapshots.filter(
            (snapshot) =>
              snapshot.status !== "not_configured" &&
              snapshot.status !== "unavailable"
          );

    return {
      providers,
      checkedAt,
    };
  }

  private selectAdapters(options: CollectOptions): QuotaProviderAdapter[] {
    const requestedProviderId = options.providerId;
    if (requestedProviderId) {
      const adapter = this.adapters.find((candidate) =>
        adapterMatchesProviderId(candidate, requestedProviderId)
      );
      if (!adapter) {
        throw new ValidationError(
          `Unknown quota provider: ${requestedProviderId}`,
          {
            module: "quota",
            op: "quota.provider.select",
          }
        );
      }
      return [adapter];
    }
    return this.adapters;
  }

  private async getSnapshot(
    userId: string,
    adapter: QuotaProviderAdapter,
    ctx: QuotaProviderContext,
    force: boolean
  ): Promise<ProviderQuotaSnapshot> {
    const cacheKey = this.getCacheKey(userId, adapter.id);
    const nowMs = this.clock.nowMs();
    const cached = this.cache.get(cacheKey);
    if (!force && cached && cached.expiresAtMs > nowMs) {
      return cached.snapshot;
    }

    const active = this.inFlight.get(cacheKey);
    if (active) {
      return await active;
    }

    const fetchPromise = this.fetchProviderSnapshot(
      userId,
      adapter,
      ctx,
      cached?.snapshot
    ).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, fetchPromise);
    return await fetchPromise;
  }

  private async fetchProviderSnapshot(
    userId: string,
    adapter: QuotaProviderAdapter,
    ctx: QuotaProviderContext,
    previous: ProviderQuotaSnapshot | undefined
  ): Promise<ProviderQuotaSnapshot> {
    const checkedAt = new Date(this.clock.nowMs()).toISOString();

    try {
      const auth = await adapter.resolveAuth(ctx);
      if (!auth.ok) {
        const snapshot = this.buildSnapshot(adapter, {
          status: "not_configured",
          attempted: false,
          checkedAt,
          windows: [],
          error: {
            code: "AUTH_NOT_CONFIGURED",
            message: auth.reason,
          },
        });
        await this.storeAndNotify(userId, snapshot, previous);
        return snapshot;
      }

      const result = await adapter.fetchQuota(auth, ctx);
      const fetchedAt = result.fetchedAt ?? checkedAt;
      const snapshot = this.buildSnapshot(adapter, {
        displayName: result.displayName,
        status: "ready",
        attempted: true,
        checkedAt,
        fetchedAt,
        authSource: auth.source,
        windows: result.windows,
      });
      await this.storeAndNotify(userId, snapshot, previous);
      return snapshot;
    } catch (error) {
      const snapshot = this.buildSnapshot(adapter, {
        status: "error",
        attempted: true,
        checkedAt,
        windows: [],
        error: {
          code: "FETCH_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      this.logger.warn("[Quota] Provider quota refresh failed", {
        providerId: adapter.id,
        error: snapshot.error?.message,
      });
      await this.storeAndNotify(userId, snapshot, previous);
      return snapshot;
    }
  }

  private buildSnapshot(
    adapter: QuotaProviderAdapter,
    params: {
      status: QuotaProviderStatus;
      attempted: boolean;
      checkedAt: string;
      windows: QuotaWindow[];
      displayName?: string;
      fetchedAt?: string;
      authSource?: QuotaAuthSource;
      error?: ProviderQuotaSnapshot["error"];
    }
  ): ProviderQuotaSnapshot {
    return {
      providerId: adapter.id,
      displayName: params.displayName ?? adapter.displayName,
      aliases: adapter.aliases,
      source: adapter.source,
      status: params.status,
      attempted: params.attempted,
      windows: params.windows,
      checkedAt: params.checkedAt,
      fetchedAt: params.fetchedAt,
      authSource: params.authSource,
      error: params.error,
    };
  }

  private async storeAndNotify(
    userId: string,
    snapshot: ProviderQuotaSnapshot,
    previous: ProviderQuotaSnapshot | undefined
  ): Promise<void> {
    const cacheKey = this.getCacheKey(userId, snapshot.providerId);
    this.cache.set(cacheKey, {
      snapshot,
      expiresAtMs: this.clock.nowMs() + this.cacheTtlMs,
    });

    await this.providerQuotaNotifier.providerQuotaRefreshed({
      userId,
      snapshot,
      previous,
      nowMs: this.clock.nowMs(),
    });
  }

  private getCacheKey(userId: string, providerId: string): string {
    return `${userId}:${providerId}`;
  }
}

function adapterMatchesProviderId(
  adapter: QuotaProviderAdapter,
  providerId: string
): boolean {
  const normalized = providerId.trim().toLowerCase();
  return (
    adapter.id.toLowerCase() === normalized ||
    adapter.aliases.some((alias) => alias.toLowerCase() === normalized)
  );
}
