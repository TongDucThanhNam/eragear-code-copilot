import type {
  RepoSnapshotIndexingSettings,
  RepoSnapshotIndexSnapshot,
  RepoSnapshotManifest,
  RepoSnapshotStorageState,
} from "../contracts/repo-snapshot-indexing.contract";

export interface RepoSnapshotIndexingRepositoryPort {
  getSettings(
    userId: string,
    projectRoot: string
  ): Promise<RepoSnapshotIndexingSettings | null>;
  saveSettings(
    userId: string,
    projectRoot: string,
    settings: RepoSnapshotIndexingSettings
  ): Promise<RepoSnapshotIndexingSettings>;
  getStorageState(projectRoot: string): Promise<RepoSnapshotStorageState>;
  writeManifest(input: {
    projectRoot: string;
    index: RepoSnapshotIndexSnapshot;
    reason: string;
    createdAt: string;
  }): Promise<{
    manifest: RepoSnapshotManifest;
    state: RepoSnapshotStorageState;
  }>;
}
