import path from "node:path";
import type {
  SupervisorProjectIntelligencePort,
  SupervisorProjectIntelligenceSnapshot,
} from "#runtime/modules/supervisor";
import { redactSensitiveTextSample } from "#runtime/shared/utils/redaction.util";
import type {
  GoalConsultationProjectGraphNodeSummary,
  GoalConsultationProjectRouteSummary,
  GoalConsultationProjectScopeSummary,
  GoalConsultationProjectSummary,
  GoalConsultationProjectSummaryPort,
  GoalConsultationProjectSymbolSummary,
} from "../application/ports/goal-consultation-project-summary.port";

const PROJECT_INTELLIGENCE_TIMEOUT_MS = 3000;
const SECONDARY_TARGET_LIMIT = 6;
const GRAPH_NODE_LIMIT = 6;
const GRAPH_EDGE_LIMIT = 8;
const GRAPH_SYMBOL_LIMIT = 12;
const SYMBOL_MATCH_LIMIT = 12;
const ROUTE_MAP_LIMIT = 8;
const STRUCTURAL_TEXT_LIMIT = 256;
const BACKSLASH_RE = /\\/g;
const LEADING_CURRENT_DIRECTORY_RE = /^\.\//;

const CODE_PATH_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sql",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

export class SupervisorGoalConsultationProjectSummaryAdapter
  implements GoalConsultationProjectSummaryPort
{
  private readonly projectIntelligence: SupervisorProjectIntelligencePort;

  constructor(projectIntelligence: SupervisorProjectIntelligencePort) {
    this.projectIntelligence = projectIntelligence;
  }

  async build(input: {
    userId: string;
    projectId: string;
    projectRoot: string;
    intent: string;
  }): Promise<GoalConsultationProjectSummary> {
    try {
      const snapshot = await withSoftTimeout(
        this.projectIntelligence.analyze(input),
        PROJECT_INTELLIGENCE_TIMEOUT_MS
      );
      return snapshot ? sanitizeSnapshot(snapshot) : unavailableSummary();
    } catch {
      return unavailableSummary();
    }
  }
}

function sanitizeSnapshot(
  snapshot: SupervisorProjectIntelligenceSnapshot
): GoalConsultationProjectSummary {
  if (snapshot.status !== "ready") {
    return unavailableSummary();
  }

  const scope = snapshot.scope ? sanitizeScope(snapshot.scope) : undefined;
  return {
    status: "ready",
    symbolExtractionMode: snapshot.symbolExtractionMode,
    ...(scope ? { scope } : {}),
    graphNodes: snapshot.graphNodes
      .flatMap((node) => {
        const nodePath = sanitizeCodePath(node.path);
        if (!nodePath) {
          return [];
        }
        const sanitized: GoalConsultationProjectGraphNodeSummary = {
          path: nodePath,
          imports: sanitizePaths(node.imports, GRAPH_EDGE_LIMIT),
          importedBy: sanitizePaths(node.importedBy, GRAPH_EDGE_LIMIT),
          exports: sanitizeLabels(node.exports, GRAPH_SYMBOL_LIMIT),
          symbols: node.symbols
            .flatMap((symbol) => {
              const name = sanitizeLabel(symbol.name);
              return name
                ? [{ name, kind: symbol.kind, line: symbol.line }]
                : [];
            })
            .slice(0, GRAPH_SYMBOL_LIMIT),
          reachableFromRoots: node.reachableFromRoots,
        };
        return [sanitized];
      })
      .slice(0, GRAPH_NODE_LIMIT),
    symbolMatches: snapshot.symbolMatches
      .flatMap((symbol) => sanitizeSymbol(symbol))
      .slice(0, SYMBOL_MATCH_LIMIT),
    routeMap: snapshot.routeMap
      .flatMap((route) => sanitizeRoute(route))
      .slice(0, ROUTE_MAP_LIMIT),
  };
}

function sanitizeScope(
  scope: NonNullable<SupervisorProjectIntelligenceSnapshot["scope"]>
): GoalConsultationProjectScopeSummary | undefined {
  const primaryPath = sanitizeCodePath(scope.primaryTarget.path);
  const secondaryPaths = sanitizePaths(
    scope.secondaryTargets.map((target) => target.path),
    SECONDARY_TARGET_LIMIT
  );
  if (!(primaryPath || secondaryPaths.length > 0)) {
    return undefined;
  }
  return {
    resolverVersion: scope.resolverVersion,
    ...(primaryPath ? { primaryPath } : {}),
    secondaryPaths,
    resolvedViaLLM: scope.resolvedViaLLM,
  };
}

function sanitizeSymbol(
  symbol: SupervisorProjectIntelligenceSnapshot["symbolMatches"][number]
): GoalConsultationProjectSymbolSummary[] {
  const symbolPath = sanitizeCodePath(symbol.path);
  const name = sanitizeLabel(symbol.name);
  return symbolPath && name
    ? [
        {
          path: symbolPath,
          name,
          kind: symbol.kind,
          line: symbol.line,
          source: symbol.source,
        },
      ]
    : [];
}

function sanitizeRoute(
  route: SupervisorProjectIntelligenceSnapshot["routeMap"][number]
): GoalConsultationProjectRouteSummary[] {
  const routePath = sanitizeCodePath(route.path);
  const routeKey = sanitizeLabel(route.routeKey);
  return routePath && routeKey
    ? [
        {
          path: routePath,
          routeKey,
          exportedSymbols: sanitizeLabels(
            route.exportedSymbols,
            GRAPH_SYMBOL_LIMIT
          ),
        },
      ]
    : [];
}

function sanitizePaths(values: string[], limit: number): string[] {
  return [
    ...new Set(values.flatMap((value) => sanitizeCodePath(value) ?? [])),
  ].slice(0, limit);
}

function sanitizeLabels(values: string[], limit: number): string[] {
  return [
    ...new Set(values.flatMap((value) => sanitizeLabel(value) ?? [])),
  ].slice(0, limit);
}

function sanitizeCodePath(value: string): string | undefined {
  const normalized = value
    .replace(BACKSLASH_RE, "/")
    .replace(LEADING_CURRENT_DIRECTORY_RE, "");
  if (
    !normalized ||
    normalized.length > STRUCTURAL_TEXT_LIMIT ||
    normalized.includes(":") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    normalized
      .split("/")
      .some((segment) => !segment || segment.startsWith(".")) ||
    !CODE_PATH_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())
  ) {
    return undefined;
  }
  return sanitizeLabel(normalized);
}

function sanitizeLabel(value: string): string | undefined {
  const sanitized = redactSensitiveTextSample(value)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, STRUCTURAL_TEXT_LIMIT);
  return sanitized || undefined;
}

function unavailableSummary(): GoalConsultationProjectSummary {
  return {
    status: "unavailable",
    symbolExtractionMode: "none",
    graphNodes: [],
    symbolMatches: [],
    routeMap: [],
  };
}

async function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([promise.catch(() => undefined), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
