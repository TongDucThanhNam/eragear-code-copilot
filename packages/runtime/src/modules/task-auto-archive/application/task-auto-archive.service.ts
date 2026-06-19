import {
  DEFAULT_TASK_AUTO_ARCHIVE_OLDER_THAN_DAYS,
  type RunTaskAutoArchiveForUsersInput,
  type RunTaskAutoArchiveInput,
  type TaskAutoArchiveRunResult,
  type TaskAutoArchiveSettings,
  type TaskAutoArchiveStatus,
  type UpdateTaskAutoArchiveSettingsInput,
} from "./contracts/task-auto-archive.contract";
import type { TaskAutoArchiveRepositoryPort } from "./ports/task-auto-archive-repository.port";
import type {
  TaskAutoArchiveSession,
  TaskAutoArchiveSessionPort,
} from "./ports/task-auto-archive-session.port";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_LIMIT = 250;

export class TaskAutoArchiveService {
  private readonly repository: TaskAutoArchiveRepositoryPort;
  private readonly sessions: TaskAutoArchiveSessionPort;
  private readonly nowMs: () => number;

  constructor(deps: {
    repository: TaskAutoArchiveRepositoryPort;
    sessions: TaskAutoArchiveSessionPort;
    nowMs?: () => number;
  }) {
    this.repository = deps.repository;
    this.sessions = deps.sessions;
    this.nowMs = deps.nowMs ?? (() => Date.now());
  }

  async getStatus(userId: string): Promise<TaskAutoArchiveStatus> {
    return await this.repository.read((snapshot) => ({
      settings: this.resolveSettingsFromSnapshot(
        snapshot.settingsByUserId,
        userId
      ),
      lastRun: snapshot.lastRunByUserId[userId],
    }));
  }

  async updateSettings(
    userId: string,
    input: UpdateTaskAutoArchiveSettingsInput
  ): Promise<TaskAutoArchiveStatus> {
    return await this.repository.mutate((snapshot) => {
      const current = this.resolveSettingsFromSnapshot(
        snapshot.settingsByUserId,
        userId
      );
      const next: TaskAutoArchiveSettings = {
        ...current,
        enabled: input.enabled ?? current.enabled,
        olderThanDays: input.olderThanDays ?? current.olderThanDays,
        userConfigured: true,
        updatedAt: new Date(this.nowMs()).toISOString(),
      };
      snapshot.settingsByUserId[userId] = next;
      return {
        settings: next,
        lastRun: snapshot.lastRunByUserId[userId],
      };
    });
  }

  async run(
    userId: string,
    input: RunTaskAutoArchiveInput = {}
  ): Promise<TaskAutoArchiveRunResult> {
    return await this.runForUsers({
      userIds: [userId],
      dryRun: input?.dryRun,
    });
  }

  async runForUsers(
    input: RunTaskAutoArchiveForUsersInput = {}
  ): Promise<TaskAutoArchiveRunResult> {
    const checkedAtMs = this.nowMs();
    const checkedAt = new Date(checkedAtMs).toISOString();
    const targetUserIds = normalizeUserIds(input?.userIds);
    const settingsByUserId = new Map<string, TaskAutoArchiveSettings>();
    const touchedUserIds = new Set<string>(targetUserIds);
    const dryRun = input?.dryRun ?? false;
    const result: TaskAutoArchiveRunResult = {
      checkedAt,
      cutoffMs: checkedAtMs,
      dryRun,
      inspected: 0,
      archived: 0,
      eligible: 0,
      skippedPinned: 0,
      skippedRunning: 0,
      skippedArchived: 0,
      skippedRecent: 0,
      failed: 0,
      userIds: [],
      archivedSessionIds: [],
      diagnostics: [],
    };

    let cursor: string | undefined;
    do {
      const page = await this.sessions.listPage({
        cursor,
        limit: DEFAULT_PAGE_LIMIT,
      });
      for (const session of page.sessions) {
        await this.processSession(session, {
          checkedAtMs,
          dryRun,
          result,
          settingsByUserId,
          targetUserIds,
          touchedUserIds,
        });
      }
      cursor = page.nextCursor;
      if (!page.hasMore) {
        break;
      }
    } while (cursor);

    result.userIds = [...touchedUserIds].sort((left, right) =>
      left.localeCompare(right)
    );
    if (result.userIds.length === 0) {
      result.diagnostics.push("No users were available for task auto-archive.");
    }
    for (const userId of result.userIds) {
      const settings = await this.getCachedSettings(settingsByUserId, userId);
      await this.recordRunForUser(userId, settings, result, checkedAt);
      if (!settings.enabled) {
        result.diagnostics.push(`Task auto-archive is disabled for ${userId}.`);
      }
    }

    return result;
  }

  private async processSession(
    session: TaskAutoArchiveSession,
    context: {
      checkedAtMs: number;
      dryRun: boolean;
      result: TaskAutoArchiveRunResult;
      settingsByUserId: Map<string, TaskAutoArchiveSettings>;
      targetUserIds: string[];
      touchedUserIds: Set<string>;
    }
  ): Promise<void> {
    if (
      context.targetUserIds.length > 0 &&
      !context.targetUserIds.includes(session.userId)
    ) {
      return;
    }

    context.touchedUserIds.add(session.userId);
    const settings = await this.getCachedSettings(
      context.settingsByUserId,
      session.userId
    );
    if (!settings.enabled) {
      return;
    }

    const cutoffMs =
      context.checkedAtMs - Math.max(1, settings.olderThanDays) * MS_PER_DAY;
    context.result.cutoffMs = Math.min(context.result.cutoffMs, cutoffMs);
    context.result.inspected += 1;

    const skipReason = this.archiveSkipReason(session, cutoffMs);
    if (skipReason) {
      context.result[skipReason] += 1;
      return;
    }

    context.result.eligible += 1;
    if (context.dryRun) {
      return;
    }

    try {
      await this.sessions.archiveSession(session.id, session.userId);
      context.result.archived += 1;
      context.result.archivedSessionIds.push(session.id);
    } catch (error) {
      context.result.failed += 1;
      context.result.diagnostics.push(
        `Failed to archive ${session.id}: ${errorMessage(error)}`
      );
    }
  }

  private archiveSkipReason(
    session: TaskAutoArchiveSession,
    cutoffMs: number
  ):
    | "skippedArchived"
    | "skippedPinned"
    | "skippedRunning"
    | "skippedRecent"
    | null {
    if (session.archived) {
      return "skippedArchived";
    }
    if (session.pinned) {
      return "skippedPinned";
    }
    if (
      session.status === "running" ||
      this.sessions.isActiveSession(session.id)
    ) {
      return "skippedRunning";
    }
    if (session.lastActiveAt >= cutoffMs) {
      return "skippedRecent";
    }
    return null;
  }

  private async getCachedSettings(
    cache: Map<string, TaskAutoArchiveSettings>,
    userId: string
  ): Promise<TaskAutoArchiveSettings> {
    const cached = cache.get(userId);
    if (cached) {
      return cached;
    }
    const settings = await this.resolveSettings(userId);
    cache.set(userId, settings);
    return settings;
  }

  private async resolveSettings(
    userId: string
  ): Promise<TaskAutoArchiveSettings> {
    return await this.repository.read((snapshot) =>
      this.resolveSettingsFromSnapshot(snapshot.settingsByUserId, userId)
    );
  }

  private resolveSettingsFromSnapshot(
    settingsByUserId: Readonly<Record<string, TaskAutoArchiveSettings>>,
    userId: string
  ): TaskAutoArchiveSettings {
    const existing = settingsByUserId[userId];
    if (existing) {
      return existing;
    }
    return {
      enabled: false,
      olderThanDays: DEFAULT_TASK_AUTO_ARCHIVE_OLDER_THAN_DAYS,
      userConfigured: false,
      updatedAt: new Date(this.nowMs()).toISOString(),
    };
  }

  private async recordRunForUser(
    userId: string,
    settings: TaskAutoArchiveSettings,
    result: TaskAutoArchiveRunResult,
    checkedAt: string
  ): Promise<void> {
    await this.repository.mutate((snapshot) => {
      snapshot.lastRunByUserId[userId] = result;
      snapshot.settingsByUserId[userId] = {
        ...settings,
        lastRunAt: checkedAt,
      };
    });
  }
}

function normalizeUserIds(input: string[] | undefined): string[] {
  return [...new Set((input ?? []).map((id) => id.trim()).filter(Boolean))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
