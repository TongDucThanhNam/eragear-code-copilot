import {
  LocalAdeRepoSnapshotIndexAdapter,
  type LocalAdeRepoSnapshotIndexSource,
} from "#runtime/modules/repo-snapshot-indexing/di";
import {
  ScopeImportGraphService,
  ScopeResolverService,
} from "#runtime/modules/scope-resolution";
import type { ScopeResolutionUseCases } from "#runtime/modules/use-cases";

export function createScopeResolutionUseCases(
  localAde: LocalAdeRepoSnapshotIndexSource
): ScopeResolutionUseCases {
  return {
    scopeResolver: new ScopeResolverService({
      index: new LocalAdeRepoSnapshotIndexAdapter(localAde),
      importGraph: new ScopeImportGraphService(),
    }),
  };
}
