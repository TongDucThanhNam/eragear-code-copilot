import { ENV } from "#runtime/config/environment";
import type { BackgroundTaskSpec } from "#runtime/shared/types/background.types";

export interface ProviderQuotaResetDispatcher {
  dispatchDueQuotaResets(input: { userIds: string[]; now?: string }): Promise<{
    users: number;
    dueWindows: number;
    refreshedProviders: number;
    dispatchedRuns: number;
    queuedRunsExecuted: number;
    skippedBots: number;
    failedProviders: number;
  }>;
}

export function createProviderQuotaResetDispatchTask(params: {
  dispatcher: ProviderQuotaResetDispatcher;
  getUserIds: () => string[];
}): BackgroundTaskSpec {
  return {
    name: "provider-quota-reset-dispatch",
    intervalMs: ENV.backgroundProviderQuotaResetDispatchIntervalMs,
    timeoutMs: ENV.backgroundTaskTimeoutMs,
    run: async () => {
      const userIds = [
        ...new Set(
          params
            .getUserIds()
            .map((id) => id.trim())
            .filter(Boolean)
        ),
      ];
      if (userIds.length === 0) {
        return {
          users: 0,
          dueWindows: 0,
          refreshedProviders: 0,
          dispatchedRuns: 0,
          queuedRunsExecuted: 0,
          skippedBots: 0,
          failedProviders: 0,
        };
      }
      return await params.dispatcher.dispatchDueQuotaResets({
        userIds,
        now: new Date().toISOString(),
      });
    },
  };
}
