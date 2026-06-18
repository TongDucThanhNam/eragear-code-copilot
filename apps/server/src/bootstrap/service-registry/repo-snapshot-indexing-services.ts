import {
  RepoSnapshotIndexingFileRepository,
  RepoSnapshotIndexingService,
} from "@/modules/repo-snapshot-indexing";
import {
  LocalAdeRepoSnapshotIndexAdapter,
  type LocalAdeRepoSnapshotIndexSource,
} from "@/modules/repo-snapshot-indexing/di";
import type { RepoSnapshotIndexingUseCases } from "@/modules/use-cases";
import { getStorageFileSync } from "@/platform/storage/storage-path";

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
