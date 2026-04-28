import type { SupervisorPermissionSnapshot } from "./ports/supervisor-decision.port";
import type { SupervisorPermissionDecision } from "./supervisor.schemas";
import type { SupervisorPolicy } from "./supervisor-policy";

// ── Deny pattern constants ──────────────────────────────────────────────────

/**
 * Destructive operations that should never be auto-approved.
 * Covers git operations, deployment actions, and destructive file operations.
 */
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\bcommit\b/i,
  /\bpush\b/i,
  /\bforce\s*push\b/i,
  /\bdeploy\b/i,
  /\brelease\b/i,
  /\bpublish\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bdrop\b/i,
  /\brm\s/i,
  /\brm$/i,
];

/**
 * Credential/secret access patterns that should never be auto-approved.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bcredential\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bapi\s*key\b/i,
  /\bpassword\b/i,
];

/**
 * Sensitive file patterns — files that typically contain secrets.
 */
const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /\.env\b/,
  /\.env\./,
  /\.pem\b/,
  /\.key\b/,
  /\.secret\b/i,
];

/**
 * Path traversal patterns — requests outside the project root.
 */
const PATH_TRAVERSAL_PATTERNS: readonly RegExp[] = [
  /\.\.\//,
  /\.\.\\/,
  /\/etc\//,
  /\/root\//,
  /\/var\/log/i,
];

/**
 * Patterns to detect when user task goal explicitly requests destructive operations.
 * Used to bypass hard-deny when the user intentionally asked for the operation.
 */
const USER_INTENT_DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\bcommit\b/i,
  /\bpush\b/i,
  /\bdeploy\b/i,
  /\brelease\b/i,
  /\bpublish\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
];

// ── Helper functions ────────────────────────────────────────────────────────

function matchPatterns(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function extractInputText(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input && typeof input === "object") {
    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }
  return "";
}

/**
 * Check if the user's task goal explicitly requests an operation that would
 * otherwise be denied. When the user explicitly asks for the operation,
 * we allow it through to the LLM for a nuanced decision.
 */
function isUserRequestedOperation(
  taskGoal: string,
  denyCategory: "destructive" | "credential" | "path_traversal"
): boolean {
  switch (denyCategory) {
    case "destructive":
      return matchPatterns(taskGoal, USER_INTENT_DESTRUCTIVE_PATTERNS);
    case "credential":
      // User rarely explicitly asks to access credentials in a way that needs bypass
      return false;
    case "path_traversal":
      // Path traversal is never user-intended — these are always blocked
      return false;
    default:
      return false;
  }
}

// ── Main exported function ──────────────────────────────────────────────────

/**
 * Deterministic hard-deny evaluation for permission requests.
 *
 * Runs BEFORE the LLM permission decision to block clearly disallowed
 * operations without incurring LLM cost.
 *
 * @param snapshot - The permission request snapshot (toolName, input, title, taskGoal)
 * @param policy - The supervisor policy (checked for hardDenyEnabled flag)
 * @returns A rejection decision if the operation should be hard-denied, or null to pass through
 *
 * Pure function: no side effects, deterministic output for same inputs.
 */
export function evaluateHardDeny(
  snapshot: SupervisorPermissionSnapshot,
  policy: SupervisorPolicy
): SupervisorPermissionDecision | null {
  // Feature flag: if hard-deny is disabled, all operations pass through
  if (policy.hardDenyEnabled === false) {
    return null;
  }

  const toolName = snapshot.toolName ?? "";
  const title = snapshot.title ?? "";
  const inputText = extractInputText(snapshot.input);
  const taskGoal = snapshot.taskGoal ?? "";

  // Combine tool name + title + input for comprehensive matching
  const combinedText = `${toolName} ${title} ${inputText}`;

  // ── Check 1: Destructive operations ─────────────────────────────────────
  if (matchPatterns(combinedText, DESTRUCTIVE_PATTERNS)) {
    if (isUserRequestedOperation(taskGoal, "destructive")) {
      // User explicitly requested this operation — let LLM decide
      return null;
    }
    const matchedPattern = DESTRUCTIVE_PATTERNS.find((p) =>
      p.test(combinedText)
    );
    return {
      action: "reject",
      reason: `Hard-deny: destructive operation detected (${matchedPattern?.source ?? "unknown"})`,
    };
  }

  // ── Check 2: Credential/secret access ───────────────────────────────────
  if (matchPatterns(combinedText, CREDENTIAL_PATTERNS)) {
    return {
      action: "reject",
      reason: "Hard-deny: credential/secret access detected",
    };
  }

  // ── Check 3: Sensitive file access ──────────────────────────────────────
  if (matchPatterns(combinedText, SECRET_FILE_PATTERNS)) {
    return {
      action: "reject",
      reason: "Hard-deny: sensitive file access detected",
    };
  }

  // ── Check 4: Path traversal ─────────────────────────────────────────────
  if (matchPatterns(combinedText, PATH_TRAVERSAL_PATTERNS)) {
    return {
      action: "reject",
      reason: "Hard-deny: out-of-project-root path traversal detected",
    };
  }

  // All checks passed — allow through to LLM decision
  return null;
}
