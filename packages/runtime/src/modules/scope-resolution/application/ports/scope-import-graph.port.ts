import type { RepoSnapshotIndexData } from "#runtime/modules/repo-snapshot-indexing";

export interface ScopeImportGraphSymbol {
  name: string;
  kind: "class" | "function" | "interface" | "type" | "component" | "export";
  line: number;
}

export interface ScopeRouteMapEntry {
  path: string;
  routeKey: string;
  workspace: string;
  exportedSymbols: string[];
}

export interface ScopeImportGraphNode {
  path: string;
  imports: string[];
  exports: string[];
  importedBy: string[];
  symbols: ScopeImportGraphSymbol[];
  workspace: string;
  routeKey?: string;
  reachableFromRoots: boolean;
}

export interface ScopeImportGraphIndex {
  importGraph: true;
  projectRoot: string;
  indexedAt: string;
  nodes: ScopeImportGraphNode[];
  routeMap: ScopeRouteMapEntry[];
  diagnostics: string[];
}

export interface ScopeImportGraphInvalidateInput {
  projectRoot: string;
  path: string;
}

export interface ScopeImportGraphPort {
  getGraph(data: RepoSnapshotIndexData): Promise<ScopeImportGraphIndex>;
  invalidateFile(input: ScopeImportGraphInvalidateInput): Promise<void> | void;
}
