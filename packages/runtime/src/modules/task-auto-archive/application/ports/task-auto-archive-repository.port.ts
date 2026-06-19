import type {
  TaskAutoArchiveRunResult,
  TaskAutoArchiveSettings,
} from "../contracts/task-auto-archive.contract";

export interface TaskAutoArchiveRepositoryPort {
  read<T>(
    reader: (snapshot: TaskAutoArchiveStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (snapshot: MutableTaskAutoArchiveStoreSnapshot) => T | Promise<T>
  ): Promise<T>;
}

export interface TaskAutoArchiveStoreSnapshot {
  settingsByUserId: Readonly<Record<string, TaskAutoArchiveSettings>>;
  lastRunByUserId: Readonly<Record<string, TaskAutoArchiveRunResult>>;
}

export interface MutableTaskAutoArchiveStoreSnapshot {
  settingsByUserId: Record<string, TaskAutoArchiveSettings>;
  lastRunByUserId: Record<string, TaskAutoArchiveRunResult>;
}
