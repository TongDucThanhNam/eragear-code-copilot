export {
  type ResolverVersion,
  ResolverVersionSchema,
  type ScopeResolution,
  ScopeResolutionSchema,
  type ScopeResolverInput,
  ScopeResolverInputSchema,
  type ScopeTarget,
  ScopeTargetSchema,
} from "./application/contracts/scope-resolution.contract";
export {
  buildScopeImportGraphIndex,
  buildScopeImportGraphIndexFromSources,
  ScopeImportGraphService,
} from "./application/import-graph.index";
export type {
  ScopeImportGraphIndex,
  ScopeImportGraphInvalidateInput,
  ScopeImportGraphNode,
  ScopeImportGraphPort,
  ScopeImportGraphSymbol,
  ScopeRouteMapEntry,
} from "./application/ports/scope-import-graph.port";
export type {
  ScopeResolutionDisambiguationInput,
  ScopeResolutionDisambiguatorPort,
} from "./application/ports/scope-resolution-disambiguator.port";
export {
  buildDeterministicV0Targets,
  buildDeterministicV1Targets,
  ScopeResolverService,
} from "./application/scope-resolver.service";
