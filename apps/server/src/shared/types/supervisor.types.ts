export type SupervisorMode = "off" | "full_autopilot";

export type SupervisorStatus =
  | "idle"
  | "queued"
  | "reviewing"
  | "continuing"
  | "done"
  | "needs_user"
  | "aborted"
  | "error"
  | "disabled";

export type SupervisorDecisionAction =
  | "done"
  | "continue"
  | "needs_user"
  | "abort";

export interface SupervisorDecisionSummary {
  action: SupervisorDecisionAction;
  reason: string;
  followUpPrompt?: string;
}

// --- Semantic Types (Internal) ---

export type SupervisorSemanticAction =
  | "CONTINUE"
  | "APPROVE_GATE"
  | "CORRECT"
  | "REPLAN"
  | "DONE"
  | "ESCALATE"
  | "ABORT"
  | "SAVE_MEMORY"
  | "WAIT";

export interface SupervisorSemanticDecision {
  semanticAction: SupervisorSemanticAction;
  runtimeAction: SupervisorDecisionAction;
  reason: string;
  followUpPrompt?: string;
}

export function mapSemanticToRuntime(
  action: SupervisorSemanticAction
): SupervisorDecisionAction {
  switch (action) {
    case "CONTINUE":
    case "APPROVE_GATE":
    case "CORRECT":
    case "REPLAN":
    case "SAVE_MEMORY":
      return "continue";
    case "DONE":
      return "done";
    case "ESCALATE":
    case "WAIT":
      return "needs_user";
    case "ABORT":
      return "abort";
  }
}

export interface SupervisorSessionState {
  mode: SupervisorMode;
  status: SupervisorStatus;
  reason?: string;
  runId?: string;
  runStartedAt?: number;
  updatedAt?: number;
  continuationCount?: number;
  lastTurnId?: string;
  lastDecision?: SupervisorDecisionSummary;
}
