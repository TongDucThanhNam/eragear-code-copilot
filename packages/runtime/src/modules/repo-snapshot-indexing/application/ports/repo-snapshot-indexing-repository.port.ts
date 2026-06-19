import type {
  RepoSnapshotIndexingSettings,
  RepoSnapshotIndexSnapshot,
  RepoSnapshotManifest,
  RepoSnapshotStorageState,
} from "../contracts/repo-snapshot-indexing.contract";

export interface RepoSnapshotIndexingSettingsScope {
  userId: string;
  projectRoot: string;
}

export interface RepoSnapshotIndexingSettingsSnapshot {
  get(
    scope: RepoSnapshotIndexingSettingsScope
  ): RepoSnapshotIndexingSettings | null;
}

export interface MutableRepoSnapshotIndexingSettingsSnapshot
  extends RepoSnapshotIndexingSettingsSnapshot {
  set(
    scope: RepoSnapshotIndexingSettingsScope,
    settings: RepoSnapshotIndexingSettings
  ): void;
}

export interface RepoSnapshotIndexingRepositoryPort {
  readSettings<T>(
    reader: (snapshot: RepoSnapshotIndexingSettingsSnapshot) => T | Promise<T>
  ): Promise<T>;
  mutateSettings<T>(
    mutator: (
      snapshot: MutableRepoSnapshotIndexingSettingsSnapshot
    ) => T | Promise<T>
  ): Promise<T>;
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
