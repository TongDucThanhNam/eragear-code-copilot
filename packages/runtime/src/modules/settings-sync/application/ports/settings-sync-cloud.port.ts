import type { SettingsSyncRemoteSnapshot } from "../contracts/settings-sync.contract";

export interface SettingsSyncCloudPort {
  readRemoteSnapshot(
    userId: string
  ): Promise<SettingsSyncRemoteSnapshot | null>;
  writeRemoteSnapshot(snapshot: SettingsSyncRemoteSnapshot): Promise<void>;
}
