import type {
  RefreshRepoSnapshotIndexInput,
  RepoSnapshotIndexData,
  RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexSearchResult,
  SearchRepoSnapshotIndexInput,
} from "../contracts/repo-snapshot-indexing.contract";

export interface RepoSnapshotIndexPort {
  getIndexSnapshot(
    userId: string,
    input?: RepoSnapshotIndexingProjectInput
  ): Promise<RepoSnapshotIndexData>;
  refreshIndex(
    userId: string,
    input?: RefreshRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexData>;
  searchIndex(
    userId: string,
    input: SearchRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexSearchResult>;
}
