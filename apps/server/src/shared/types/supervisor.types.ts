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
