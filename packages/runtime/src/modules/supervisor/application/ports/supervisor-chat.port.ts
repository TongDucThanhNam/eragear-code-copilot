import type { Plan } from "#runtime/modules/session/domain/stored-session.types";
import type { SupervisorSessionState } from "#runtime/shared/types/supervisor.types";

export interface SupervisorSideChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SupervisorGoalModeAuditSummary {
  phaseId: string;
  kind: string;
  decision?: string;
  summary?: string;
  targetPath?: string;
  verification?: string;
  occurredAt?: string | number;
}

export interface SupervisorProjectContextFile {
  path: string;
  kind: "readme" | "manifest" | "entry" | "config";
  excerpt: string;
}

export interface SupervisorProjectContextSnapshot {
  topLevelEntries: string[];
  files: SupervisorProjectContextFile[];
  diagnostics: string[];
}

export interface SupervisorProjectIntelligenceScopeTarget {
  path: string;
  score: number;
  reason: string;
}

export interface SupervisorProjectIntelligenceScope {
  resolverVersion: "v0-no-graph" | "v1-import-graph";
  primaryTarget: SupervisorProjectIntelligenceScopeTarget;
  secondaryTargets: SupervisorProjectIntelligenceScopeTarget[];
  resolvedViaLLM: boolean;
  graphConfidence?: number;
}

export interface SupervisorProjectIntelligenceSymbol {
  path: string;
  name: string;
  kind: "class" | "function" | "interface" | "type" | "component" | "export";
  line: number;
  source: "ast-import-graph" | "repo-index";
}

export interface SupervisorProjectIntelligenceGraphNode {
  path: string;
  workspace: string;
  routeKey?: string;
  imports: string[];
  importedBy: string[];
  exports: string[];
  symbols: Omit<SupervisorProjectIntelligenceSymbol, "path" | "source">[];
  reachableFromRoots: boolean;
}

export interface SupervisorProjectIntelligenceRoute {
  path: string;
  routeKey: string;
  workspace: string;
  exportedSymbols: string[];
}

export interface SupervisorProjectIntelligenceSnapshot {
  status: "ready" | "unavailable";
  symbolExtractionMode: "ast" | "regex" | "none";
  scope?: SupervisorProjectIntelligenceScope;
  graphNodes: SupervisorProjectIntelligenceGraphNode[];
  symbolMatches: SupervisorProjectIntelligenceSymbol[];
  routeMap: SupervisorProjectIntelligenceRoute[];
  diagnostics: string[];
}

export interface SupervisorChatSnapshot {
  userId: string;
  chatId: string;
  projectId?: string;
  projectRoot: string;
  projectContext: SupervisorProjectContextSnapshot;
  projectIntelligence: SupervisorProjectIntelligenceSnapshot;
  userMessage: string;
  sideChatHistory: SupervisorSideChatMessage[];
  goalModeAudit: SupervisorGoalModeAuditSummary[];
  plan?: Plan;
  supervisor: SupervisorSessionState;
}

export interface SupervisorChatResponse {
  content: string;
  model: string;
  provider: "acp" | "minimax" | "timeout";
}

export interface SupervisorChatPort {
  respond(input: SupervisorChatSnapshot): Promise<SupervisorChatResponse>;
}

export interface SupervisorProjectContextPort {
  build(input: {
    projectRoot: string;
  }): Promise<SupervisorProjectContextSnapshot>;
}

export interface SupervisorProjectIntelligencePort {
  analyze(input: {
    userId: string;
    projectId?: string;
    projectRoot: string;
    intent: string;
    phaseGoal?: string;
    activePathHints?: string[];
  }): Promise<SupervisorProjectIntelligenceSnapshot>;
}
