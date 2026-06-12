import type { SettingsSyncState } from "../contracts/settings-sync.contract";

export interface SettingsSyncStateRepositoryPort {
  getState(userId: string): Promise<SettingsSyncState | null>;
  saveState(state: SettingsSyncState): Promise<SettingsSyncState>;
}
