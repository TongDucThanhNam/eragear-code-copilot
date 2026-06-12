import { ENV } from "@/config/environment";
import type { BackgroundTaskSpec } from "@/shared/types/background.types";

export interface TaskAutoArchiveRunner {
  runForUsers(input: { userIds?: string[]; dryRun?: boolean }): Promise<{
    checkedAt: string;
    cutoffMs: number;
    dryRun: boolean;
    inspected: number;
    archived: number;
    eligible: number;
    skippedPinned: number;
    skippedRunning: number;
    skippedArchived: number;
    skippedRecent: number;
    failed: number;
    userIds: string[];
    archivedSessionIds: string[];
    diagnostics: string[];
  }>;
}

export function createTaskAutoArchiveTask(params: {
  runner: TaskAutoArchiveRunner;
  getUserIds: () => string[];
}): BackgroundTaskSpec {
  return {
    name: "task-auto-archive",
    intervalMs: ENV.backgroundTaskAutoArchiveIntervalMs,
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
      const result = await params.runner.runForUsers({
        userIds,
      });
      return {
        inspected: result.inspected,
        eligible: result.eligible,
        archived: result.archived,
        failed: result.failed,
        skippedPinned: result.skippedPinned,
        skippedRunning: result.skippedRunning,
        skippedArchived: result.skippedArchived,
        skippedRecent: result.skippedRecent,
        users: result.userIds.length,
        dryRun: result.dryRun,
      };
    },
  };
}
