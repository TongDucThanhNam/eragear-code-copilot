import type { SettingsSyncState } from "../contracts/settings-sync.contract";

export interface SettingsSyncStateSnapshot {
  get(): SettingsSyncState | null;
}

export interface MutableSettingsSyncStateSnapshot
  extends SettingsSyncStateSnapshot {
  set(state: SettingsSyncState): void;
}

export interface SettingsSyncStateRepositoryPort {
  readState<T>(
    userId: string,
    reader: (snapshot: SettingsSyncStateSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutateState<T>(
    userId: string,
    mutator: (snapshot: MutableSettingsSyncStateSnapshot) => T | Promise<T>
  ): Promise<T>;
}
