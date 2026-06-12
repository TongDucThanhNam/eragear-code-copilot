import {
  type RefreshRepoSnapshotIndexInput,
  type RepoSnapshotIndexData,
  RepoSnapshotIndexingFileRepository,
  type RepoSnapshotIndexingProjectInput,
  RepoSnapshotIndexingService,
  type RepoSnapshotIndexPort,
  type RepoSnapshotIndexSearchResult,
  type SearchRepoSnapshotIndexInput,
} from "@/modules/repo-snapshot-indexing";
import type { LocalAdeService } from "@/modules/settings";
import type {
  RepoSnapshotIndexingUseCases,
  UseCasePort,
} from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

type LocalAdeSnapshot = Awaited<ReturnType<LocalAdeService["snapshot"]>>;

class LocalAdeRepoSnapshotIndexAdapter implements RepoSnapshotIndexPort {
  private readonly localAde: UseCasePort<LocalAdeService>;

  constructor(localAde: UseCasePort<LocalAdeService>) {
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

function toIndexData(snapshot: LocalAdeSnapshot): RepoSnapshotIndexData {
  return {
    projectRoot: snapshot.projectRoot,
    index: snapshot.projectIndex,
  };
}

export function createRepoSnapshotIndexingUseCases(
  localAde: UseCasePort<LocalAdeService>
): RepoSnapshotIndexingUseCases {
  return {
    repoSnapshotIndexing: new RepoSnapshotIndexingService({
      index: new LocalAdeRepoSnapshotIndexAdapter(localAde),
      repository: new RepoSnapshotIndexingFileRepository({
        filePath: () => getStorageFileSync("repo-snapshot-indexing.json"),
      }),
    }),
  };
}
