export interface LegacyDelegatedHandoff {
  status: string;
  turnId: string;
}

export type AutopilotActivationState = "already_active" | "enabled" | "failed";

const LEGACY_HANDOFF_TURN_RE = /^- Turn:\s*(.+)$/m;
const LEGACY_HANDOFF_STATUS_RE = /^- Status:\s*(.+)$/m;
const PROMPT_BUSY_PATTERNS = [
  /\bPROMPT_BUSY\b/i,
  /A prompt is already in progress for this session/i,
  /prompt is still running/i,
];

export function parseLegacyDelegatedHandoff(
  content: string
): LegacyDelegatedHandoff | null {
  if (
    !(
      content.includes("Enhanced prompt sent to the main coding agent.") &&
      content.includes("Supervisor mode: off") &&
      content.includes("Prompt sent:") &&
      content.includes("Supervisos delegated enhanced task.")
    )
  ) {
    return null;
  }

  const turnId = content.match(LEGACY_HANDOFF_TURN_RE)?.[1]?.trim();
  const status = content.match(LEGACY_HANDOFF_STATUS_RE)?.[1]?.trim();
  if (!(turnId && status)) {
    return null;
  }
  return { status, turnId };
}

export function formatSupervisosHandoffStatus(input: {
  activation: AutopilotActivationState;
  activationError?: string;
  status: string;
  turnId: string;
}): string {
  const isActive = input.activation !== "failed";
  const autopilotLine = formatAutopilotLine(input);

  return [
    "Task handed to the main coding agent.",
    "",
    `- Turn: ${input.turnId}`,
    `- Status: ${input.status}`,
    `- Supervisos: ${isActive ? "active" : "not active"}`,
    autopilotLine,
    "",
    isActive
      ? "I will read the completed turn, check verification/scope gates, and decide continue or done through the existing supervisor loop."
      : "The task was submitted, but Supervisos could not enable Autopilot from this request. Enable Autopilot to allow continue/done decisions.",
  ].join("\n");
}

export function buildQueuedSupervisosMainPrompt(
  originalRequest: string
): string {
  const request = originalRequest.trim();
  return [
    "Supervisos queued delegated task.",
    "",
    "Original user request:",
    request,
    "",
    "Implementation instructions:",
    "- Treat the original request as the current user-approved scope.",
    "- Read the existing project structure first and follow its stack and conventions.",
    "- Build the actual usable experience, not a placeholder explanation.",
    "- For website/UI work, use visual assets, polished responsive layout, and verify desktop/mobile text does not overlap.",
    "- Keep changes scoped to the requested experience and avoid unrelated refactors.",
    "- Do not commit, push, delete unrelated files, or perform destructive actions unless the human explicitly asks.",
    "- Run the relevant verification command(s). If a dev server is needed, start it and report the local URL.",
    "",
    "Completion response expected:",
    "- Summarize changed files.",
    "- Report verification commands and results.",
    "- Report the local preview URL if one is running.",
  ].join("\n");
}

export function isPromptBusyError(error: unknown): boolean {
  const candidates = collectErrorText(error);
  return candidates.some((candidate) =>
    PROMPT_BUSY_PATTERNS.some((pattern) => pattern.test(candidate))
  );
}

function collectErrorText(error: unknown): string[] {
  if (error instanceof Error) {
    const details = [error.message, error.name];
    if ("code" in error && typeof error.code === "string") {
      details.push(error.code);
    }
    return details;
  }
  if (typeof error === "string") {
    return [error];
  }
  if (error && typeof error === "object") {
    const details: string[] = [];
    for (const key of ["message", "code", "name"] as const) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === "string") {
        details.push(value);
      }
    }
    return details;
  }
  return [];
}

function formatAutopilotLine(input: {
  activation: AutopilotActivationState;
  activationError?: string;
}): string {
  if (input.activation === "enabled") {
    return "- Autopilot: enabled for this session";
  }
  if (input.activation === "already_active") {
    return "- Autopilot: already enabled";
  }
  return `- Autopilot: enable failed${
    input.activationError ? ` (${input.activationError})` : ""
  }`;
}
