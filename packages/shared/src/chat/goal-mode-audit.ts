export type GoalModeGateReason =
  | "scope_drift_modified"
  | "scope_drift_created"
  | "file_deleted"
  | "destructive_action"
  | "verification_failed";

export type GoalModeGateResult =
  | { decision: "auto_continue"; reasons: [] }
  | { decision: "needs_user"; reasons: GoalModeGateReason[] };

export interface GoalModeScopeTarget {
  path: string;
  score: number;
  reason: string;
}

export interface GoalModeScopeResolution {
  resolverVersion: "v0-no-graph" | "v1-import-graph";
  primaryTarget: GoalModeScopeTarget;
  secondaryTargets: GoalModeScopeTarget[];
  resolvedViaLLM: boolean;
  diagnostics: {
    signalScanSkippedBySize: number;
    symbolExtractionMode: "regex" | "ast";
    indexedFiles?: number;
    candidateCount?: number;
    deterministicGap?: number;
    graphConfidence?: number;
  };
}

export interface GoalModeVerificationResult {
  command: string;
  exitCode: number | null;
}

export interface GoalModeOutcomeSummary {
  keyDecision: string;
  filesChanged: string[];
  gotcha: string;
  verification: string;
}

export interface GoalModeAuditEntry {
  goalId: string;
  phaseId: string;
  attemptId?: string;
  kind:
    | "scope_resolution"
    | "phase_attempt"
    | "gate_result"
    | "verification_result"
    | "decision";
  occurredAt: string;
  scopeResolution?: GoalModeScopeResolution;
  filesAllowed?: string[];
  filesTouched?: string[];
  filesCreated?: string[];
  filesDeleted?: string[];
  gate?: GoalModeGateResult;
  verification?: GoalModeVerificationResult;
  outcomeSummary?: GoalModeOutcomeSummary;
  decisionReason?: string;
}
