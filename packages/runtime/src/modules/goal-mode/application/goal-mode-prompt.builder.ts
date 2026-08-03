import type {
  GoalModeOutcomeSummary,
  PhaseRecord,
  SupervisorGoalState,
} from "./goal-mode.schemas";

const DEFAULT_PROMPT_BUDGET_CHARS = 12_000;

export interface GoalModeNextPromptInput {
  goal: SupervisorGoalState;
  currentPhase: PhaseRecord;
  completedSummaries: GoalModeOutcomeSummary[];
  verificationCommand?: string;
  maxChars?: number;
}

export function buildGoalModeNextPrompt(
  input: GoalModeNextPromptInput
): string {
  const maxChars = input.maxChars ?? DEFAULT_PROMPT_BUDGET_CHARS;
  const sections = [
    section("Original intent", input.goal.originalIntent),
    section("Stable constraints", bulletList(input.goal.constraints)),
    section(
      "Completed phase summaries",
      compactSummaries(input.completedSummaries)
    ),
    section("Current phase goal", input.currentPhase.goal),
    section("Allowed files", bulletList(input.currentPhase.filesAllowed)),
    section(
      "Verification requirement",
      input.verificationCommand ??
        input.currentPhase.verificationCommand ??
        "Record the strongest available verification evidence."
    ),
    section(
      "Continuation guard",
      [
        "Do not use raw prior transcript.",
        "Do not use raw diffs.",
        "Stop for user review on deletion, destructive action, verification failure, or scope drift.",
      ].join("\n")
    ),
  ].filter(Boolean);

  return clampPrompt(sections.join("\n\n"), maxChars);
}

function compactSummaries(summaries: GoalModeOutcomeSummary[]): string {
  if (summaries.length === 0) {
    return "No completed phases yet.";
  }
  return summaries
    .map((summary, index) =>
      [
        `${index + 1}. Key decision: ${summary.keyDecision}`,
        `Files changed: ${summary.filesChanged.join(", ") || "none"}`,
        `Gotcha: ${summary.gotcha || "none"}`,
        `Verification: ${summary.verification || "not recorded"}`,
      ].join("\n")
    )
    .join("\n");
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "none";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function section(title: string, body: string): string {
  return `## ${title}\n${body.trim()}`;
}

function clampPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 40)).trimEnd()}\n[compact prompt truncated]`;
}
