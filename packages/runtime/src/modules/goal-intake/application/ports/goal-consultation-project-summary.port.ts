export interface GoalConsultationProjectScopeSummary {
  resolverVersion: "v0-no-graph" | "v1-import-graph";
  primaryPath?: string;
  secondaryPaths: string[];
  resolvedViaLLM: boolean;
}

export interface GoalConsultationProjectGraphNodeSummary {
  path: string;
  imports: string[];
  importedBy: string[];
  exports: string[];
  symbols: Array<{
    name: string;
    kind: "class" | "function" | "interface" | "type" | "component" | "export";
    line: number;
  }>;
  reachableFromRoots: boolean;
}

export interface GoalConsultationProjectSymbolSummary {
  path: string;
  name: string;
  kind: "class" | "function" | "interface" | "type" | "component" | "export";
  line: number;
  source: "ast-import-graph" | "repo-index";
}

export interface GoalConsultationProjectRouteSummary {
  path: string;
  routeKey: string;
  exportedSymbols: string[];
}

export interface GoalConsultationProjectSummary {
  status: "ready" | "unavailable";
  symbolExtractionMode: "ast" | "regex" | "none";
  scope?: GoalConsultationProjectScopeSummary;
  graphNodes: GoalConsultationProjectGraphNodeSummary[];
  symbolMatches: GoalConsultationProjectSymbolSummary[];
  routeMap: GoalConsultationProjectRouteSummary[];
}

export interface GoalConsultationProjectSummaryPort {
  build(input: {
    userId: string;
    projectId: string;
    projectRoot: string;
    intent: string;
  }): Promise<GoalConsultationProjectSummary>;
}
