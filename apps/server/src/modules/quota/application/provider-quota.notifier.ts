import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type {
  ProviderQuotaSnapshot,
  QuotaWindow,
} from "./contracts/quota.contract";

export interface ProviderQuotaRefreshNotification {
  userId: string;
  snapshot: ProviderQuotaSnapshot;
  previous?: ProviderQuotaSnapshot;
  nowMs: number;
}

export interface ProviderQuotaNotifier {
  providerQuotaRefreshed(
    input: ProviderQuotaRefreshNotification
  ): Promise<void>;
}

export function createEventBusProviderQuotaNotifier(
  eventBus: EventBusPort
): ProviderQuotaNotifier {
  return {
    async providerQuotaRefreshed(input) {
      if (input.snapshot.status === "unavailable") {
        return;
      }

      await eventBus.publish({
        type: "provider_quota_refreshed",
        userId: input.userId,
        providerId: input.snapshot.providerId,
        providerDisplayName: input.snapshot.displayName,
        status: input.snapshot.status,
        previousStatus: input.previous?.status,
        fetchedAt: input.snapshot.fetchedAt ?? input.snapshot.checkedAt,
        windows: input.snapshot.windows,
        minPercentRemaining: getMinPercentRemaining(input.snapshot.windows),
        nextResetAt: getNextResetAt(input.snapshot.windows, input.nowMs),
        changed: didSnapshotChange(input.previous, input.snapshot),
      });
    },
  };
}

export const noopProviderQuotaNotifier: ProviderQuotaNotifier = {
  providerQuotaRefreshed: () => Promise.resolve(),
};

function getMinPercentRemaining(windows: QuotaWindow[]): number | undefined {
  const values = windows
    .map((window) => window.percentRemaining)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) {
    return undefined;
  }
  return Math.min(...values);
}

function getNextResetAt(
  windows: QuotaWindow[],
  nowMs: number
): string | undefined {
  const futureResetTimes = windows
    .map((window) => (window.resetAt ? Date.parse(window.resetAt) : Number.NaN))
    .filter((value) => Number.isFinite(value) && value >= nowMs)
    .sort((left, right) => left - right);
  const next = futureResetTimes[0];
  return next === undefined ? undefined : new Date(next).toISOString();
}

function didSnapshotChange(
  previous: ProviderQuotaSnapshot | undefined,
  next: ProviderQuotaSnapshot
): boolean {
  if (!previous) {
    return true;
  }
  return (
    previous.status !== next.status ||
    previous.error?.code !== next.error?.code ||
    previous.error?.message !== next.error?.message ||
    JSON.stringify(previous.windows) !== JSON.stringify(next.windows)
  );
}
