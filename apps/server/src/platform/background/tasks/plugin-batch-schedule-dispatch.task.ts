import { ENV } from "@/config/environment";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";

export interface PluginBatchScheduleDispatcher {
  dispatchDuePluginBatchSchedules(input: {
    userIds: string[];
    now?: string;
  }): Promise<{
    users: number;
    projects: number;
    dueSchedules: number;
    dispatchedSchedules: number;
    failedProjects: number;
  }>;
}

export function createPluginBatchScheduleDispatchTask(params: {
  dispatcher: PluginBatchScheduleDispatcher;
  getUserIds: () => string[];
}): BackgroundTaskSpec {
  return {
    name: "plugin-batch-schedule-dispatch",
    intervalMs: ENV.backgroundPluginBatchScheduleIntervalMs,
    timeoutMs: ENV.backgroundTaskTimeoutMs,
    run: async () => {
      const userIds = [...new Set(params.getUserIds().map((id) => id.trim()).filter(Boolean))];
      if (userIds.length === 0) {
        return {
          users: 0,
          projects: 0,
          dueSchedules: 0,
          dispatchedSchedules: 0,
          failedProjects: 0,
        };
      }
      return await params.dispatcher.dispatchDuePluginBatchSchedules({
        userIds,
        now: new Date().toISOString(),
      });
    },
  };
}
