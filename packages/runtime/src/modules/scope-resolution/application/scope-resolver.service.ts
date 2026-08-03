import path from "node:path";
import type {
  RepoSnapshotIndexData,
  RepoSnapshotIndexFile,
  RepoSnapshotIndexSnapshot,
  RepoSnapshotIndexSymbol,
  RepoSnapshotIndexTask,
} from "#runtime/modules/repo-snapshot-indexing";
import type { RepoSnapshotIndexPort } from "#runtime/modules/repo-snapshot-indexing/application/ports/repo-snapshot-index.port";
import type {
  ScopeResolution,
  ScopeResolverInput,
  ScopeTarget,
} from "./contracts/scope-resolution.contract";
import type {
  ScopeImportGraphIndex,
  ScopeImportGraphNode,
  ScopeImportGraphPort,
} from "./ports/scope-import-graph.port";
import type { ScopeResolutionDisambiguatorPort } from "./ports/scope-resolution-disambiguator.port";

const DEFAULT_SCOPE_TARGET_LIMIT = 8;
const DISAMBIGUATION_TOP_K = 5;
const AMBIGUOUS_SCORE_GAP = 5;
const LEADING_SLASH_PATTERN = /^\/+/;
const TRAILING_SLASH_PATTERN = /\/+$/;

interface ScopeCandidate {
  path: string;
  score: number;
  reasons: string[];
}

interface ScopeResolverServiceDeps {
  index: RepoSnapshotIndexPort;
  disambiguator?: ScopeResolutionDisambiguatorPort;
  importGraph?: ScopeImportGraphPort;
}

export class ScopeResolverService {
  private readonly index: RepoSnapshotIndexPort;
  private readonly disambiguator?: ScopeResolutionDisambiguatorPort;
  private readonly importGraph?: ScopeImportGraphPort;

  constructor(deps: ScopeResolverServiceDeps) {
    this.index = deps.index;
    this.disambiguator = deps.disambiguator;
    this.importGraph = deps.importGraph;
  }

  async resolve(
    userId: string,
    input: ScopeResolverInput
  ): Promise<ScopeResolution> {
    const data = await this.index.getIndexSnapshot(userId, {
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
    return await this.resolveFromIndex(data, input);
  }

  async resolveFromIndex(
    data: RepoSnapshotIndexData,
    input: ScopeResolverInput
  ): Promise<ScopeResolution> {
    const graph = this.importGraph
      ? await this.importGraph.getGraph(data)
      : null;
    const graphTargets = graph
      ? buildDeterministicV1Targets(data.index, input, graph)
      : null;
    const targets =
      graphTargets?.targets ?? buildDeterministicV0Targets(data.index, input);
    const firstTarget = targets[0];
    const secondTarget = targets[1];
    const deterministicGap =
      firstTarget && secondTarget
        ? firstTarget.score - secondTarget.score
        : undefined;
    let rankedTargets = targets;
    let resolvedViaLLM = false;

    if (
      this.disambiguator &&
      targets.length > 1 &&
      (deterministicGap ?? Number.POSITIVE_INFINITY) < AMBIGUOUS_SCORE_GAP
    ) {
      const topK = targets.slice(0, DISAMBIGUATION_TOP_K);
      const chosen = await this.disambiguator.chooseTarget({
        intent: input.intent,
        ...(input.phaseGoal ? { phaseGoal: input.phaseGoal } : {}),
        candidates: topK,
      });
      if (chosen) {
        const chosenIndex = topK.findIndex((item) => item.path === chosen.path);
        if (chosenIndex >= 0) {
          const chosenTarget = topK[chosenIndex];
          if (chosenTarget) {
            rankedTargets = [
              chosenTarget,
              ...targets.filter((item) => item.path !== chosen.path),
            ];
            resolvedViaLLM = true;
          }
        }
      }
    }

    const primaryTarget = rankedTargets[0] ?? {
      path: "",
      score: 0,
      reason: "No indexed files matched the requested scope.",
    };
    const limit = input.limit ?? DEFAULT_SCOPE_TARGET_LIMIT;
    const resolverVersion = graphTargets ? "v1-import-graph" : "v0-no-graph";
    return {
      resolverVersion,
      primaryTarget,
      secondaryTargets: rankedTargets.slice(1, limit),
      resolvedViaLLM,
      diagnostics: {
        signalScanSkippedBySize: countSignalScanSizeSkips(data.index),
        symbolExtractionMode: graphTargets ? "ast" : "regex",
        indexedFiles: data.index.indexedFiles,
        candidateCount: rankedTargets.length,
        ...(deterministicGap !== undefined ? { deterministicGap } : {}),
        ...(graphTargets
          ? { graphConfidence: graphTargets.graphConfidence }
          : {}),
      },
    };
  }

  async invalidateImportGraphFile(input: {
    projectRoot: string;
    path: string;
  }): Promise<void> {
    await this.importGraph?.invalidateFile(input);
  }
}

export function buildDeterministicV0Targets(
  index: RepoSnapshotIndexSnapshot,
  input: ScopeResolverInput
): ScopeTarget[] {
  const tokens = tokenizeScopeQuery([input.intent, input.phaseGoal].join(" "));
  const phrase = normalizeText([input.intent, input.phaseGoal].join(" "));
  const activePathHints = (input.activePathHints ?? []).map(normalizePathHint);
  const symbolsByPath = groupByPath(index.symbols);
  const tasksByPath = groupByPath(index.tasks);
  const latestMtime = latestModifiedTime(index.files);

  const candidates = index.files.map((file) =>
    scoreFile({
      file,
      phrase,
      tokens,
      activePathHints,
      symbols: symbolsByPath.get(file.path) ?? [],
      tasks: tasksByPath.get(file.path) ?? [],
      latestMtime,
    })
  );

  return candidates
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path)
    )
    .map((candidate) => ({
      path: candidate.path,
      score: roundScore(candidate.score),
      reason: candidate.reasons.join("; ") || "Low-confidence recency match",
    }));
}

export function buildDeterministicV1Targets(
  index: RepoSnapshotIndexSnapshot,
  input: ScopeResolverInput,
  graph: ScopeImportGraphIndex
): { targets: ScopeTarget[]; graphConfidence: number } {
  const baseTargets = buildDeterministicV0Targets(index, input);
  const candidates = new Map<string, ScopeCandidate>();
  for (const target of baseTargets) {
    candidates.set(target.path, {
      path: target.path,
      score: target.score,
      reasons: [target.reason],
    });
  }

  const tokens = tokenizeScopeQuery([input.intent, input.phaseGoal].join(" "));
  const phrase = normalizeText([input.intent, input.phaseGoal].join(" "));
  const activePathHints = (input.activePathHints ?? []).map(normalizePathHint);
  let totalGraphScore = 0;
  for (const node of graph.nodes) {
    const graphScore = scoreGraphNode({
      node,
      phrase,
      tokens,
      activePathHints,
      routeMap: graph.routeMap,
    });
    if (graphScore.score <= 0) {
      continue;
    }
    totalGraphScore += graphScore.score;
    const current = candidates.get(node.path) ?? {
      path: node.path,
      score: 0,
      reasons: [],
    };
    current.score += graphScore.score;
    current.reasons.push(...graphScore.reasons);
    candidates.set(node.path, current);
  }

  const targets = [...candidates.values()]
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path)
    )
    .map((candidate) => ({
      path: candidate.path,
      score: roundScore(candidate.score),
      reason: candidate.reasons.join("; "),
    }));

  return {
    targets,
    graphConfidence:
      targets.length === 0
        ? 0
        : Math.min(1, roundScore(totalGraphScore / (targets.length * 24))),
  };
}

function scoreGraphNode(params: {
  node: ScopeImportGraphNode;
  phrase: string;
  tokens: string[];
  activePathHints: string[];
  routeMap: ScopeImportGraphIndex["routeMap"];
}): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const normalizedWorkspace = normalizeText(params.node.workspace);
  const routeKey = params.node.routeKey ?? "";
  const symbolText = normalizeText(
    params.node.symbols
      .map((symbol) => `${symbol.name} ${symbol.kind}`)
      .join(" ")
  );

  const workspaceScore =
    params.tokens.some((token) => normalizedWorkspace.includes(token)) ||
    params.activePathHints.some((hint) =>
      normalizeSlash(params.node.path).startsWith(hint)
    )
      ? 8
      : 0;
  if (workspaceScore > 0) {
    score += workspaceScore;
    reasons.push(`importGraph workspace match +${workspaceScore}`);
  }

  const routeScore =
    scoreText({
      text: routeKey,
      phrase: params.phrase,
      tokens: params.tokens,
    }) * 6;
  if (routeScore > 0) {
    score += routeScore;
    reasons.push(`routeMap match +${roundScore(routeScore)}`);
  }

  const astSymbolScore =
    scoreText({
      text: symbolText,
      phrase: params.phrase,
      tokens: params.tokens,
    }) *
    (params.node.symbols.some((symbol) => symbol.kind === "component") ? 8 : 5);
  if (astSymbolScore > 0) {
    score += astSymbolScore;
    reasons.push(`importGraph AST symbol match +${roundScore(astSymbolScore)}`);
  }

  const reachabilityScore = params.node.reachableFromRoots ? 3 : 0;
  if (reachabilityScore > 0) {
    score += reachabilityScore;
    reasons.push(`reachability root path +${reachabilityScore}`);
  }

  const importedByRouteScore = params.node.importedBy.some((importer) =>
    params.routeMap.some((route) => route.path === importer)
  )
    ? 4
    : 0;
  if (importedByRouteScore > 0) {
    score += importedByRouteScore;
    reasons.push(`reachability route import +${importedByRouteScore}`);
  }

  return { score, reasons };
}

function scoreFile(params: {
  file: RepoSnapshotIndexFile;
  phrase: string;
  tokens: string[];
  activePathHints: string[];
  symbols: RepoSnapshotIndexSymbol[];
  tasks: RepoSnapshotIndexTask[];
  latestMtime: number | null;
}): ScopeCandidate {
  const reasons: string[] = [];
  let score = 0;
  const normalizedPath = normalizeText(params.file.path);
  const basename = normalizeText(path.basename(params.file.path));

  const pathScore =
    scoreText({
      text: normalizedPath,
      phrase: params.phrase,
      tokens: params.tokens,
    }) * 3;
  if (pathScore > 0) {
    score += pathScore;
    reasons.push(`path/name match +${roundScore(pathScore)}`);
  }

  const basenameScore =
    scoreText({
      text: basename,
      phrase: params.phrase,
      tokens: params.tokens,
    }) * 2;
  if (basenameScore > 0) {
    score += basenameScore;
    reasons.push(`basename match +${roundScore(basenameScore)}`);
  }

  const symbolScore = params.symbols.reduce((sum, symbol) => {
    const symbolText = normalizeText(`${symbol.name} ${symbol.kind}`);
    return (
      sum +
      scoreText({
        text: symbolText,
        phrase: params.phrase,
        tokens: params.tokens,
      }) *
        (symbol.kind === "component" ? 7 : 5)
    );
  }, 0);
  if (symbolScore > 0) {
    score += symbolScore;
    reasons.push(`symbol match +${roundScore(symbolScore)}`);
  }

  const taskScore = params.tasks.reduce((sum, task) => {
    const taskText = normalizeText(`${task.marker} ${task.text}`);
    return (
      sum +
      scoreText({
        text: taskText,
        phrase: params.phrase,
        tokens: params.tokens,
      }) *
        4
    );
  }, 0);
  if (taskScore > 0) {
    score += taskScore;
    reasons.push(`task marker match +${roundScore(taskScore)}`);
  }

  const semanticScore =
    scoreText({
      text: normalizeText((params.file.semanticTags ?? []).join(" ")),
      phrase: params.phrase,
      tokens: params.tokens,
    }) * 2.5;
  if (semanticScore > 0) {
    score += semanticScore;
    reasons.push(`semantic tag match +${roundScore(semanticScore)}`);
  }

  const pathHintScore = params.activePathHints.some((hint) =>
    normalizeSlash(params.file.path).startsWith(hint)
  )
    ? 3
    : 0;
  if (pathHintScore > 0) {
    score += pathHintScore;
    reasons.push(`active workspace hint +${pathHintScore}`);
  }

  const recencyScore = scoreRecency(params.file, params.latestMtime);
  if (recencyScore > 0) {
    score += recencyScore;
    reasons.push(`mtime recency +${roundScore(recencyScore)}`);
  }

  return { path: params.file.path, score, reasons };
}

function scoreText(params: {
  text: string;
  phrase: string;
  tokens: string[];
}): number {
  if (params.text.length === 0 || params.tokens.length === 0) {
    return 0;
  }
  let score = 0;
  if (params.phrase.length > 2 && params.text.includes(params.phrase)) {
    score += 3;
  }
  for (const token of params.tokens) {
    if (params.text === token) {
      score += 2;
    } else if (params.text.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function scoreRecency(
  file: RepoSnapshotIndexFile,
  latestMtime: number | null
): number {
  if (!(latestMtime && file.modifiedAt)) {
    return 0;
  }
  const mtime = Date.parse(file.modifiedAt);
  if (!Number.isFinite(mtime)) {
    return 0;
  }
  const ageMs = Math.max(0, latestMtime - mtime);
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs) {
    return 1;
  }
  if (ageMs <= 7 * dayMs) {
    return 0.5;
  }
  return 0.1;
}

function latestModifiedTime(files: RepoSnapshotIndexFile[]): number | null {
  const times = files
    .map((file) => (file.modifiedAt ? Date.parse(file.modifiedAt) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) {
    return null;
  }
  return Math.max(...times);
}

function groupByPath<T extends { path: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const current = map.get(item.path) ?? [];
    current.push(item);
    map.set(item.path, current);
  }
  return map;
}

function countSignalScanSizeSkips(index: RepoSnapshotIndexSnapshot): number {
  return index.diagnostics.filter((diagnostic) =>
    diagnostic.includes("signalScanSkippedBySize")
  ).length;
}

function tokenizeScopeQuery(value: string): string[] {
  return [
    ...new Set(
      normalizeText(value)
        .split(/[^a-z0-9_$]+/g)
        .flatMap(splitIdentifier)
        .filter((token) => token.length > 1)
    ),
  ].slice(0, 24);
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._/-]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizePathHint(value: string): string {
  return normalizeSlash(value)
    .replace(LEADING_SLASH_PATTERN, "")
    .replace(TRAILING_SLASH_PATTERN, "");
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}
