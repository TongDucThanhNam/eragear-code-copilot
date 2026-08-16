const FIVE_HOUR_WINDOW_RE = /\b5\s*h(?:our)?s?\b/;
const DAILY_WINDOW_RE = /\b(?:day|daily|24\s*h)\b/;
const WEEKLY_WINDOW_RE = /\b(?:week|weekly|7\s*d)\b/;
const WORD_SEPARATOR_RE = /[-_]+/;

export type QuotaWindowHealth =
  | "available"
  | "low"
  | "exhausted"
  | "unlimited"
  | "unknown";

export interface QuotaWindowPresentationInput {
  id: string;
  label: string;
  windowType?: string;
  scope?: string;
  usageKind?: "model_tokens" | "tool_calls";
  percentRemaining?: number;
  unlimited?: boolean;
}

export interface QuotaEstimatePresentationInput {
  confidence?: "unavailable" | "low" | "medium" | "high";
  projectedTokenCapacity?: number;
  reasons?: readonly string[];
}

export interface QuotaEstimateEmptyState {
  label: string;
  detail: string;
}

export function formatQuotaReset(
  value: string,
  nowMs: number = Date.now()
): string {
  const resetMs = Date.parse(value);
  if (Number.isNaN(resetMs)) {
    return "Reset time unavailable";
  }

  const remainingMs = resetMs - nowMs;
  if (remainingMs <= 0) {
    return "Reset due";
  }

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes}m`);
  }

  return `Resets in ${parts.join(" ")}`;
}

export function getQuotaWindowHealth(
  window: Pick<QuotaWindowPresentationInput, "percentRemaining" | "unlimited">
): QuotaWindowHealth {
  if (window.unlimited) {
    return "unlimited";
  }
  if (window.percentRemaining === undefined) {
    return "unknown";
  }
  if (window.percentRemaining <= 0) {
    return "exhausted";
  }
  if (window.percentRemaining <= 25) {
    return "low";
  }
  return "available";
}

export function formatQuotaWindowTitle(
  window: QuotaWindowPresentationInput
): string {
  const value = `${window.windowType ?? ""} ${window.id} ${window.label}`
    .trim()
    .toLowerCase();
  if (FIVE_HOUR_WINDOW_RE.test(value)) {
    return "5-hour limit";
  }
  if (DAILY_WINDOW_RE.test(value)) {
    return "Daily limit";
  }
  if (WEEKLY_WINDOW_RE.test(value)) {
    return "Weekly limit";
  }
  if (value.includes("mcp")) {
    return "MCP usage";
  }
  return window.label;
}

export function isToolCallQuotaWindow(
  window: Pick<
    QuotaWindowPresentationInput,
    "id" | "label" | "usageKind" | "windowType"
  >
): boolean {
  if (window.usageKind) {
    return window.usageKind === "tool_calls";
  }
  return `${window.windowType ?? ""} ${window.id} ${window.label}`
    .toLowerCase()
    .includes("mcp");
}

export function formatQuotaWindowScope(
  window: QuotaWindowPresentationInput
): string | undefined {
  const scope = window.scope?.trim() ?? inferScopeFromLabel(window.label);
  if (!scope) {
    return undefined;
  }
  if (scope.toLowerCase() === "general") {
    return "General models";
  }
  return `${toTitleCase(scope)} models`;
}

export function getQuotaHealthLabel(health: QuotaWindowHealth): string {
  switch (health) {
    case "available":
      return "Available";
    case "low":
      return "Running low";
    case "exhausted":
      return "Exhausted";
    case "unlimited":
      return "Unlimited";
    case "unknown":
      return "Unknown";
    default:
      return "Unknown";
  }
}

export function getQuotaEstimateEmptyState(
  estimate: QuotaEstimatePresentationInput | undefined
): QuotaEstimateEmptyState {
  const reasons = estimate?.reasons ?? [];
  if (reasons.some((reason) => reason.includes("MCP tool calls"))) {
    return {
      label: "MCP calls only",
      detail: "Use the provider-reported MCP counters for this limit.",
    };
  }
  if (reasons.some((reason) => reason.includes("reported as unlimited"))) {
    return {
      label: "Not needed",
      detail: "This provider reports the window as unlimited.",
    };
  }
  if (
    reasons.some((reason) =>
      reason.includes("did not report a usable remaining percentage")
    )
  ) {
    return {
      label: "Percentage unavailable",
      detail:
        "The provider does not expose enough quota data to estimate capacity.",
    };
  }
  if (reasons.some((reason) => reason.includes("first observed this cycle"))) {
    return {
      label: "Partial cycle",
      detail:
        "Wait for quota movement or the next full cycle to build an estimate.",
    };
  }
  if (
    reasons.some((reason) =>
      reason.includes("no matching local provider-attributed tokens")
    )
  ) {
    return {
      label: "Usage not matched",
      detail:
        "Quota changed, but no matching usage was found in supported local logs.",
    };
  }
  if (
    reasons.some((reason) =>
      reason.includes("two quota snapshots with measurable movement")
    )
  ) {
    return {
      label: "No quota change yet",
      detail: "Use this provider, then refresh after the percentage changes.",
    };
  }
  return {
    label: "More data needed",
    detail:
      "Use this provider and refresh later to estimate full-cycle capacity.",
  };
}

function inferScopeFromLabel(label: string): string | undefined {
  const separatorIndex = label.lastIndexOf(" - ");
  if (separatorIndex === -1) {
    return undefined;
  }
  const scope = label.slice(separatorIndex + 3).trim();
  return scope || undefined;
}

function toTitleCase(value: string): string {
  return value
    .split(WORD_SEPARATOR_RE)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
