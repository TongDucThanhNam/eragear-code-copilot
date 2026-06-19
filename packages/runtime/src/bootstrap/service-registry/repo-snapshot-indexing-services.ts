import {
  RepoSnapshotIndexingFileRepository,
  RepoSnapshotIndexingService,
} from "#runtime/modules/repo-snapshot-indexing";
import {
  LocalAdeRepoSnapshotIndexAdapter,
  type LocalAdeRepoSnapshotIndexSource,
} from "#runtime/modules/repo-snapshot-indexing/di";
import type { RepoSnapshotIndexingUseCases } from "#runtime/modules/use-cases";
import { getStorageFileSync } from "#runtime/platform/storage/storage-path";

export function createRepoSnapshotIndexingUseCases(
  localAde: LocalAdeRepoSnapshotIndexSource
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
