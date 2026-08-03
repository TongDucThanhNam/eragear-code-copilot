import type { QuotaWindow } from "#runtime/modules/quota";
import { ValidationError } from "#runtime/shared/errors";
import { redactSensitiveTextSample } from "#runtime/shared/utils/redaction.util";
import type {
  BotAdmissionState,
  BotDefinition,
  BotProviderLease,
} from "./contracts/bots.contract";
import type { BotRepositoryPort } from "./ports/bot-repository.port";

const DEFAULT_FRESHNESS_MS = 2 * 60 * 1000;
const DEFAULT_RECHECK_MS = 60 * 1000;
const DEFAULT_LEASE_MS = 4 * 60 * 60 * 1000;

interface ProviderQuotaRefreshPort {
  refresh(
    userId: string,
    input?: {
      providerId?: string;
      includeUnavailable?: boolean;
      force?: boolean;
    }
  ): Promise<{
    checkedAt: string;
    providers: AdmissionQuotaSnapshot[];
  }>;
}

interface AdmissionQuotaSnapshot {
  providerId: string;
  displayName: string;
  aliases?: string[];
  status: "ready" | "not_configured" | "unavailable" | "error";
  windows: QuotaWindow[];
  checkedAt?: string;
  fetchedAt?: string;
  error?: { message: string };
}

interface TaskQueueEntitlementPort {
  checkFeature(
    userId: string,
    input: { featureId: "task_queue" }
  ): Promise<{ enabled: boolean; reason?: string }>;
}

export interface ProviderAdmissionResult {
  eligible: boolean;
  admission: BotAdmissionState;
  lease?: BotProviderLease;
}

export class ProviderAdmissionService {
  private readonly repository: BotRepositoryPort;
  private readonly quota: ProviderQuotaRefreshPort;
  private readonly entitlement?: TaskQueueEntitlementPort;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly freshnessMs: number;
  private readonly leaseMs: number;

  constructor(deps: {
    repository: BotRepositoryPort;
    quota: ProviderQuotaRefreshPort;
    entitlement?: TaskQueueEntitlementPort;
    now?: () => number;
    createId: () => string;
    freshnessMs?: number;
    leaseMs?: number;
  }) {
    this.repository = deps.repository;
    this.quota = deps.quota;
    this.entitlement = deps.entitlement;
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId;
    this.freshnessMs = deps.freshnessMs ?? DEFAULT_FRESHNESS_MS;
    this.leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  }

  async assertEntitled(userId: string): Promise<void> {
    if (!this.entitlement) {
      return;
    }
    const gate = await this.entitlement.checkFeature(userId, {
      featureId: "task_queue",
    });
    if (!gate.enabled) {
      throw new ValidationError(
        gate.reason ?? "The task_queue entitlement is required.",
        {
          module: "bots",
          op: "assertEntitled",
        }
      );
    }
  }

  async admit(input: {
    userId: string;
    bot: BotDefinition;
    runId: string;
  }): Promise<ProviderAdmissionResult> {
    const checkedAt = this.now();
    const providerId = resolveProviderId(input.bot);
    if (!providerId) {
      return blocked({
        status: "quota_unavailable",
        checkedAt,
        reason: "Scheduled tasks require exactly one quota provider.",
        nextCheckAt: checkedAt + DEFAULT_RECHECK_MS,
      });
    }

    if (this.entitlement) {
      const gate = await this.entitlement.checkFeature(input.userId, {
        featureId: "task_queue",
      });
      if (!gate.enabled) {
        return blocked({
          status: "entitlement_required",
          providerId,
          checkedAt,
          reason: gate.reason ?? "The task_queue entitlement is required.",
        });
      }
    }

    let refreshed: Awaited<ReturnType<ProviderQuotaRefreshPort["refresh"]>>;
    try {
      refreshed = await this.quota.refresh(input.userId, {
        providerId,
        includeUnavailable: true,
        force: true,
      });
    } catch (error) {
      return blocked({
        status: "quota_unavailable",
        providerId,
        checkedAt,
        nextCheckAt: checkedAt + DEFAULT_RECHECK_MS,
        reason: `Quota could not be verified: ${errorMessage(error)}`,
      });
    }

    const provider = findProvider(refreshed.providers, providerId);
    if (!provider || provider.status !== "ready") {
      return blocked({
        status: "quota_unavailable",
        providerId,
        checkedAt,
        nextCheckAt: checkedAt + DEFAULT_RECHECK_MS,
        reason: provider?.error?.message
          ? errorMessage(provider.error.message)
          : "The configured provider does not have a ready quota snapshot.",
      });
    }
    const fetchedAt = parseTimestamp(
      provider.fetchedAt ?? provider.checkedAt ?? refreshed.checkedAt
    );
    if (
      fetchedAt === undefined ||
      checkedAt - fetchedAt > this.freshnessMs ||
      fetchedAt - checkedAt > this.freshnessMs
    ) {
      return blocked({
        status: "quota_stale",
        providerId,
        checkedAt,
        nextCheckAt: checkedAt + DEFAULT_RECHECK_MS,
        reason: "The provider quota snapshot is stale.",
      });
    }

    const quotaConfig = input.bot.triggerConfig?.quota;
    const configuredWindowIds = quotaConfig?.windowIds ?? [];
    const candidateWindows = selectWindows(
      provider.windows,
      configuredWindowIds
    );
    if (
      candidateWindows.length === 0 ||
      !hasEveryConfiguredWindow(provider.windows, configuredWindowIds)
    ) {
      return blocked({
        status: "quota_unavailable",
        providerId,
        checkedAt,
        nextCheckAt: checkedAt + DEFAULT_RECHECK_MS,
        reason: "None of the configured quota windows are present.",
      });
    }
    const threshold = {
      minPercentRemaining: quotaConfig?.minPercentRemaining ?? 1,
      minRemaining: quotaConfig?.minRemaining,
    };
    const blockedWindow = candidateWindows.find(
      (candidate) => !satisfiesReserve(candidate, threshold)
    );
    if (blockedWindow) {
      return blocked({
        status: "below_reserve",
        providerId,
        ...windowState(blockedWindow),
        checkedAt,
        nextCheckAt: nextQuotaCheck(candidateWindows, checkedAt),
        reason: formatReserveReason(threshold),
      });
    }
    const window = mostConstrainedWindow(candidateWindows);

    const leaseResult = await this.acquireLease({
      userId: input.userId,
      providerId,
      botId: input.bot.id,
      runId: input.runId,
      checkedAt,
    });
    if (!leaseResult.acquired) {
      return blocked({
        status: "provider_busy",
        providerId,
        ...windowState(window),
        checkedAt,
        nextCheckAt: leaseResult.lease.expiresAt,
        reason: "Another scheduled ACP dispatch is active for this provider.",
      });
    }
    return {
      eligible: true,
      lease: leaseResult.lease,
      admission: {
        status: "eligible",
        providerId,
        ...windowState(window),
        checkedAt,
        leaseId: leaseResult.lease.leaseId,
      },
    };
  }

  async release(input: {
    userId: string;
    runId: string;
    leaseId?: string;
  }): Promise<void> {
    await this.repository.mutateQuotaAutomationState((snapshot) => {
      const state = snapshot.get();
      let changed = false;
      for (const [key, lease] of Object.entries(state.providerLeases)) {
        if (
          lease.userId === input.userId &&
          lease.runId === input.runId &&
          (!input.leaseId || lease.leaseId === input.leaseId)
        ) {
          delete state.providerLeases[key];
          changed = true;
        }
      }
      if (changed) {
        snapshot.set(state);
      }
    });
  }

  async reconcile(input: { userIds: string[] }): Promise<number> {
    const now = this.now();
    const userIds = new Set(input.userIds);
    const activeRunIds = new Set<string>();
    for (const userId of userIds) {
      const runs = await this.repository.listRuns(userId);
      for (const run of runs) {
        if (
          run.status === "queued" ||
          run.status === "quota_blocked" ||
          run.status === "running"
        ) {
          activeRunIds.add(run.id);
        }
      }
    }
    return await this.repository.mutateQuotaAutomationState((snapshot) => {
      const state = snapshot.get();
      let released = 0;
      for (const [key, lease] of Object.entries(state.providerLeases)) {
        if (
          lease.expiresAt <= now ||
          (userIds.has(lease.userId) && !activeRunIds.has(lease.runId))
        ) {
          delete state.providerLeases[key];
          released += 1;
        }
      }
      if (released > 0) {
        snapshot.set(state);
      }
      return released;
    });
  }

  private async acquireLease(input: {
    userId: string;
    providerId: string;
    botId: string;
    runId: string;
    checkedAt: number;
  }): Promise<{ acquired: boolean; lease: BotProviderLease }> {
    return await this.repository.mutateQuotaAutomationState((snapshot) => {
      const state = snapshot.get();
      const key = providerLeaseKey(input.userId, input.providerId);
      const existing = state.providerLeases[key];
      if (existing && existing.runId !== input.runId) {
        return { acquired: false, lease: existing };
      }
      const lease: BotProviderLease =
        existing?.runId === input.runId
          ? {
              ...existing,
              expiresAt: input.checkedAt + this.leaseMs,
            }
          : {
              leaseId: this.createId(),
              userId: input.userId,
              providerId: input.providerId,
              botId: input.botId,
              runId: input.runId,
              acquiredAt: input.checkedAt,
              expiresAt: input.checkedAt + this.leaseMs,
            };
      state.providerLeases[key] = lease;
      snapshot.set(state);
      return { acquired: true, lease };
    });
  }
}

function blocked(admission: BotAdmissionState): ProviderAdmissionResult {
  return { eligible: false, admission };
}

function resolveProviderId(bot: BotDefinition): string | undefined {
  if (bot.providerId?.trim()) {
    return bot.providerId.trim();
  }
  const legacyProviders = bot.triggerConfig?.quota?.providerIds ?? [];
  return legacyProviders.length === 1 ? legacyProviders[0]?.trim() : undefined;
}

function findProvider(
  providers: AdmissionQuotaSnapshot[],
  providerId: string
): AdmissionQuotaSnapshot | undefined {
  const normalized = providerId.toLowerCase();
  return providers.find(
    (provider) =>
      provider.providerId.toLowerCase() === normalized ||
      (provider.aliases ?? []).some(
        (alias) => alias.toLowerCase() === normalized
      )
  );
}

function selectWindows(
  windows: QuotaWindow[],
  configuredWindowIds: string[]
): QuotaWindow[] {
  if (configuredWindowIds.length === 0) {
    return windows;
  }
  const ids = new Set(configuredWindowIds.map((value) => value.toLowerCase()));
  return windows.filter(
    (window) =>
      ids.has(window.id.toLowerCase()) ||
      (window.windowType ? ids.has(window.windowType.toLowerCase()) : false)
  );
}

function hasEveryConfiguredWindow(
  windows: QuotaWindow[],
  configuredWindowIds: string[]
): boolean {
  return configuredWindowIds.every((configuredId) => {
    const normalized = configuredId.toLowerCase();
    return windows.some(
      (window) =>
        window.id.toLowerCase() === normalized ||
        window.windowType?.toLowerCase() === normalized
    );
  });
}

function mostConstrainedWindow(windows: QuotaWindow[]): QuotaWindow {
  return [...windows].sort((left, right) => {
    const leftPercent = left.unlimited
      ? Number.POSITIVE_INFINITY
      : (left.percentRemaining ?? Number.POSITIVE_INFINITY);
    const rightPercent = right.unlimited
      ? Number.POSITIVE_INFINITY
      : (right.percentRemaining ?? Number.POSITIVE_INFINITY);
    if (leftPercent !== rightPercent) {
      return leftPercent - rightPercent;
    }
    return (
      (left.remaining ?? Number.POSITIVE_INFINITY) -
      (right.remaining ?? Number.POSITIVE_INFINITY)
    );
  })[0] as QuotaWindow;
}

function satisfiesReserve(
  window: QuotaWindow,
  threshold: { minPercentRemaining: number; minRemaining?: number }
): boolean {
  if (window.unlimited) {
    return true;
  }
  if (
    threshold.minRemaining !== undefined &&
    (window.remaining === undefined ||
      window.remaining < threshold.minRemaining)
  ) {
    return false;
  }
  if (window.percentRemaining !== undefined) {
    return window.percentRemaining >= threshold.minPercentRemaining;
  }
  if (threshold.minPercentRemaining > 0) {
    return false;
  }
  return window.remaining !== undefined
    ? window.remaining > 0
    : threshold.minRemaining === undefined;
}

function windowState(window: QuotaWindow) {
  return {
    windowId: window.id,
    windowLabel: window.label,
    ...(window.percentRemaining !== undefined
      ? { percentRemaining: window.percentRemaining }
      : {}),
    ...(window.remaining !== undefined ? { remaining: window.remaining } : {}),
  };
}

function nextQuotaCheck(windows: QuotaWindow[], checkedAt: number): number {
  const resets = windows
    .map((window) => parseTimestamp(window.resetAt))
    .filter(
      (value): value is number => value !== undefined && value > checkedAt
    );
  return resets.length > 0
    ? Math.min(...resets)
    : checkedAt + DEFAULT_RECHECK_MS;
}

function formatReserveReason(threshold: {
  minPercentRemaining: number;
  minRemaining?: number;
}): string {
  const requirements = [`${threshold.minPercentRemaining}% remaining`];
  if (threshold.minRemaining !== undefined) {
    requirements.push(`${threshold.minRemaining} units remaining`);
  }
  return `Quota is below the configured reserve (${requirements.join(", ")}).`;
}

function providerLeaseKey(userId: string, providerId: string): string {
  return `${userId}|${providerId.toLowerCase()}`;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveTextSample(message).slice(0, 1000);
}
