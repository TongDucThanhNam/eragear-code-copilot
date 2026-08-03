import path from "node:path";
import type {
  RepoSnapshotIndexData,
  RepoSnapshotIndexSymbol,
} from "#runtime/modules/repo-snapshot-indexing";
import type { RepoSnapshotIndexPort } from "#runtime/modules/repo-snapshot-indexing/application/ports/repo-snapshot-index.port";
import type {
  ScopeImportGraphIndex,
  ScopeImportGraphNode,
  ScopeImportGraphPort,
  ScopeImportGraphSymbol,
  ScopeResolverService,
  ScopeRouteMapEntry,
} from "#runtime/modules/scope-resolution";
import type {
  SupervisorProjectIntelligenceGraphNode,
  SupervisorProjectIntelligencePort,
  SupervisorProjectIntelligenceRoute,
  SupervisorProjectIntelligenceScope,
  SupervisorProjectIntelligenceSnapshot,
  SupervisorProjectIntelligenceSymbol,
} from "../application/ports/supervisor-chat.port";

const SCOPE_TARGET_LIMIT = 6;
const GRAPH_NODE_LIMIT = 6;
const GRAPH_EDGE_LIMIT = 8;
const GRAPH_SYMBOL_LIMIT = 12;
const SYMBOL_MATCH_LIMIT = 12;
const ROUTE_MAP_LIMIT = 8;

export class ScopeSupervisorProjectIntelligenceAdapter
  implements SupervisorProjectIntelligencePort
{
  private readonly index: RepoSnapshotIndexPort;
  private readonly scopeResolver: Pick<ScopeResolverService, "resolve">;
  private readonly importGraph: ScopeImportGraphPort;

  constructor(deps: {
    index: RepoSnapshotIndexPort;
    scopeResolver: Pick<ScopeResolverService, "resolve">;
    importGraph: ScopeImportGraphPort;
  }) {
    this.index = deps.index;
    this.scopeResolver = deps.scopeResolver;
    this.importGraph = deps.importGraph;
  }

  async analyze(input: {
    userId: string;
    projectId?: string;
    projectRoot: string;
    intent: string;
    phaseGoal?: string;
    activePathHints?: string[];
  }): Promise<SupervisorProjectIntelligenceSnapshot> {
    const indexInput = input.projectId
      ? { projectId: input.projectId }
      : undefined;
    const data = await this.index.getIndexSnapshot(input.userId, indexInput);
    if (!isSameProjectRoot(data.projectRoot, input.projectRoot)) {
      return unavailableProjectIntelligence(
        `Repo index project root mismatch: session=${input.projectRoot}; index=${data.projectRoot}.`
      );
    }

    const [scopeResolution, graph] = await Promise.all([
      this.scopeResolver.resolve(input.userId, {
        ...(input.projectId ? { projectId: input.projectId } : {}),
        intent: input.intent,
        ...(input.phaseGoal ? { phaseGoal: input.phaseGoal } : {}),
        ...(input.activePathHints
          ? { activePathHints: input.activePathHints }
          : {}),
        limit: SCOPE_TARGET_LIMIT,
      }),
      this.importGraph.getGraph(data),
    ]);

    const scope = {
      primaryTarget: scopeResolution.primaryTarget,
      resolverVersion: scopeResolution.resolverVersion,
      resolvedViaLLM: scopeResolution.resolvedViaLLM,
      secondaryTargets: scopeResolution.secondaryTargets.slice(
        0,
        SCOPE_TARGET_LIMIT
      ),
      ...(scopeResolution.diagnostics.graphConfidence !== undefined
        ? { graphConfidence: scopeResolution.diagnostics.graphConfidence }
        : {}),
    } satisfies SupervisorProjectIntelligenceScope;
    const targetPaths = [
      scope.primaryTarget.path,
      ...scope.secondaryTargets.map((target) => target.path),
    ].filter(Boolean);
    const graphNodes = selectGraphNodes(graph, targetPaths);
    const tokens = tokenizeQuery(
      [input.intent, input.phaseGoal ?? "", ...targetPaths].join(" ")
    );
    const symbolMatches = selectSymbolMatches({ data, graph, tokens });
    const routeMap = selectRouteMap(graph.routeMap, tokens);

    return {
      status: "ready",
      symbolExtractionMode: scopeResolution.diagnostics.symbolExtractionMode,
      scope,
      graphNodes,
      symbolMatches,
      routeMap,
      diagnostics: [
        ...graph.diagnostics,
        ...(graph.nodes.length === 0
          ? ["AST import graph produced no TS/TSX nodes for indexed files."]
          : []),
      ],
    };
  }
}

function selectGraphNodes(
  graph: ScopeImportGraphIndex,
  targetPaths: string[]
): SupervisorProjectIntelligenceGraphNode[] {
  const nodesByPath = new Map(graph.nodes.map((node) => [node.path, node]));
  const selected = new Map<string, ScopeImportGraphNode>();
  for (const targetPath of targetPaths) {
    const node = nodesByPath.get(normalizeSlash(targetPath));
    if (!node) {
      continue;
    }
    selected.set(node.path, node);
    for (const relatedPath of [...node.imports, ...node.importedBy].slice(
      0,
      GRAPH_NODE_LIMIT
    )) {
      const related = nodesByPath.get(relatedPath);
      if (related) {
        selected.set(related.path, related);
      }
      if (selected.size >= GRAPH_NODE_LIMIT) {
        break;
      }
    }
    if (selected.size >= GRAPH_NODE_LIMIT) {
      break;
    }
  }

  return [...selected.values()]
    .slice(0, GRAPH_NODE_LIMIT)
    .map(toSupervisorGraphNode);
}

function toSupervisorGraphNode(
  node: ScopeImportGraphNode
): SupervisorProjectIntelligenceGraphNode {
  return {
    path: node.path,
    workspace: node.workspace,
    ...(node.routeKey ? { routeKey: node.routeKey } : {}),
    imports: node.imports.slice(0, GRAPH_EDGE_LIMIT),
    importedBy: node.importedBy.slice(0, GRAPH_EDGE_LIMIT),
    exports: node.exports.slice(0, GRAPH_SYMBOL_LIMIT),
    symbols: node.symbols.slice(0, GRAPH_SYMBOL_LIMIT).map(toGraphSymbol),
    reachableFromRoots: node.reachableFromRoots,
  };
}

function toGraphSymbol(
  symbol: ScopeImportGraphSymbol
): SupervisorProjectIntelligenceGraphNode["symbols"][number] {
  return {
    kind: symbol.kind,
    line: symbol.line,
    name: symbol.name,
  };
}

function selectSymbolMatches(params: {
  data: RepoSnapshotIndexData;
  graph: ScopeImportGraphIndex;
  tokens: string[];
}): SupervisorProjectIntelligenceSymbol[] {
  const matches: SupervisorProjectIntelligenceSymbol[] = [];
  for (const node of params.graph.nodes) {
    for (const symbol of node.symbols) {
      if (matchesToken(symbolMatchText(node.path, symbol), params.tokens)) {
        matches.push({
          path: node.path,
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
          source: "ast-import-graph",
        });
      }
    }
  }
  for (const symbol of params.data.index.symbols) {
    if (matchesToken(indexSymbolMatchText(symbol), params.tokens)) {
      matches.push({
        path: normalizeSlash(symbol.path),
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        source: "repo-index",
      });
    }
  }

  return dedupeSymbols(matches)
    .sort(
      (left, right) =>
        sourceRank(left.source) - sourceRank(right.source) ||
        left.path.localeCompare(right.path) ||
        left.line - right.line
    )
    .slice(0, SYMBOL_MATCH_LIMIT);
}

function selectRouteMap(
  routeMap: ScopeRouteMapEntry[],
  tokens: string[]
): SupervisorProjectIntelligenceRoute[] {
  const matched = routeMap.filter((route) =>
    matchesToken(
      [route.path, route.routeKey, route.workspace, ...route.exportedSymbols]
        .join(" ")
        .toLowerCase(),
      tokens
    )
  );
  const routes = matched.length > 0 ? matched : routeMap;
  return routes.slice(0, ROUTE_MAP_LIMIT).map((route) => ({
    path: route.path,
    routeKey: route.routeKey,
    workspace: route.workspace,
    exportedSymbols: route.exportedSymbols.slice(0, GRAPH_SYMBOL_LIMIT),
  }));
}

function dedupeSymbols(
  symbols: SupervisorProjectIntelligenceSymbol[]
): SupervisorProjectIntelligenceSymbol[] {
  const byKey = new Map<string, SupervisorProjectIntelligenceSymbol>();
  for (const symbol of symbols) {
    byKey.set(
      `${symbol.source}:${symbol.path}:${symbol.kind}:${symbol.name}:${symbol.line}`,
      symbol
    );
  }
  return [...byKey.values()];
}

function sourceRank(source: SupervisorProjectIntelligenceSymbol["source"]) {
  return source === "ast-import-graph" ? 0 : 1;
}

function symbolMatchText(
  pathName: string,
  symbol: ScopeImportGraphSymbol
): string {
  return `${pathName} ${symbol.name} ${symbol.kind}`.toLowerCase();
}

function indexSymbolMatchText(symbol: RepoSnapshotIndexSymbol): string {
  return `${symbol.path} ${symbol.name} ${symbol.kind} ${
    symbol.language ?? ""
  }`.toLowerCase();
}

function matchesToken(text: string, tokens: string[]): boolean {
  return tokens.length === 0 || tokens.some((token) => text.includes(token));
}

function tokenizeQuery(value: string): string[] {
  return [
    ...new Set(
      value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9_$]+/g)
        .filter((token) => token.length > 1)
    ),
  ].slice(0, 24);
}

function unavailableProjectIntelligence(
  diagnostic: string
): SupervisorProjectIntelligenceSnapshot {
  return {
    status: "unavailable",
    symbolExtractionMode: "none",
    graphNodes: [],
    symbolMatches: [],
    routeMap: [],
    diagnostics: [diagnostic],
  };
}

function isSameProjectRoot(left: string, right: string): boolean {
  return normalizeRoot(left) === normalizeRoot(right);
}

function normalizeRoot(value: string): string {
  return normalizeSlash(path.resolve(value)).toLowerCase();
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}
