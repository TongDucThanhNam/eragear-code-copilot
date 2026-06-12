import type {
  TaskAutoArchiveRunResult,
  TaskAutoArchiveSettings,
} from "../contracts/task-auto-archive.contract";

export interface TaskAutoArchiveRepositoryPort {
  getSettings(userId: string): Promise<TaskAutoArchiveSettings | null>;
  saveSettings(
    userId: string,
    settings: TaskAutoArchiveSettings
  ): Promise<TaskAutoArchiveSettings>;
  getLastRun(userId: string): Promise<TaskAutoArchiveRunResult | null>;
  saveLastRun(userId: string, result: TaskAutoArchiveRunResult): Promise<void>;
}
