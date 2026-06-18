import type {
  RefreshRepoSnapshotIndexInput,
  RepoSnapshotIndexData,
  RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexSearchResult,
  SearchRepoSnapshotIndexInput,
} from "../application/contracts/repo-snapshot-indexing.contract";
import type { RepoSnapshotIndexPort } from "../application/ports/repo-snapshot-index.port";

interface LocalAdeRepoSnapshot {
  projectRoot: string;
  projectIndex: RepoSnapshotIndexData["index"];
}

export interface LocalAdeRepoSnapshotIndexSource {
  snapshot(userId: string): Promise<LocalAdeRepoSnapshot>;
  refreshProjectIndex(
    userId: string,
    input?: RefreshRepoSnapshotIndexInput
  ): Promise<LocalAdeRepoSnapshot>;
  searchProjectIndex(
    userId: string,
    input: SearchRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexSearchResult>;
}

export class LocalAdeRepoSnapshotIndexAdapter implements RepoSnapshotIndexPort {
  private readonly localAde: LocalAdeRepoSnapshotIndexSource;

  constructor(localAde: LocalAdeRepoSnapshotIndexSource) {
    this.localAde = localAde;
  }

  async getIndexSnapshot(
    userId: string,
    _input?: RepoSnapshotIndexingProjectInput
  ): Promise<RepoSnapshotIndexData> {
    return toIndexData(await this.localAde.snapshot(userId));
  }

  async refreshIndex(
    userId: string,
    input: RefreshRepoSnapshotIndexInput = {}
  ): Promise<RepoSnapshotIndexData> {
    return toIndexData(await this.localAde.refreshProjectIndex(userId, input));
  }

  async searchIndex(
    userId: string,
    input: SearchRepoSnapshotIndexInput
  ): Promise<RepoSnapshotIndexSearchResult> {
    return await this.localAde.searchProjectIndex(userId, input);
  }
}

function toIndexData(snapshot: LocalAdeRepoSnapshot): RepoSnapshotIndexData {
  return {
    projectRoot: snapshot.projectRoot,
    index: snapshot.projectIndex,
  };
}
