import type { GateReason, GateResult } from "./goal-mode.schemas";

const BACKSLASH_PATTERN = /\\/g;
const LEADING_DOT_SLASH_PATTERN = /^\.\/+/;

export interface GoalModeGateInput {
  filesAllowed: string[];
  filesTouched: string[];
  filesCreated: string[];
  filesDeleted: string[];
  destructiveAction?: boolean;
  verification?: {
    command: string;
    exitCode: number | null;
  };
}

export function evaluateGoalModeGate(input: GoalModeGateInput): GateResult {
  const reasons: GateReason[] = [];
  const allowlist = new Set(input.filesAllowed.map(normalizePath));

  if (input.filesTouched.some((file) => !allowlist.has(normalizePath(file)))) {
    reasons.push("scope_drift_modified");
  }
  if (input.filesCreated.some((file) => !allowlist.has(normalizePath(file)))) {
    reasons.push("scope_drift_created");
  }
  if (input.filesDeleted.length > 0) {
    reasons.push("file_deleted");
  }
  if (input.destructiveAction) {
    reasons.push("destructive_action");
  }
  if (input.verification && input.verification.exitCode !== 0) {
    reasons.push("verification_failed");
  }

  if (reasons.length === 0) {
    return { decision: "auto_continue", reasons: [] };
  }
  return {
    decision: "needs_user",
    reasons: [...new Set(reasons)],
  };
}

function normalizePath(value: string): string {
  return value
    .replace(BACKSLASH_PATTERN, "/")
    .replace(LEADING_DOT_SLASH_PATTERN, "");
}
