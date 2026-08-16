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

export interface SupervisorQuotaCapacityReconciler {
  reconcileQuota(input: { userIds: string[]; now?: string }): Promise<{
    checkedProviders: number;
    suspendedWorkers: number;
    suspendedManagers: number;
  }>;
}

export function createProviderQuotaResetDispatchTask(params: {
  dispatcher: ProviderQuotaResetDispatcher;
  supervisorCapacity?: SupervisorQuotaCapacityReconciler;
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
      const now = new Date().toISOString();
      const dispatched = await params.dispatcher.dispatchDueQuotaResets({
        userIds,
        now,
      });
      const supervisor = await params.supervisorCapacity?.reconcileQuota({
        userIds,
        now,
      });
      return {
        ...dispatched,
        ...(supervisor
          ? {
              supervisorCheckedProviders: supervisor.checkedProviders,
              supervisorSuspendedWorkers: supervisor.suspendedWorkers,
              supervisorSuspendedManagers: supervisor.suspendedManagers,
            }
          : {}),
      };
    },
  };
}
