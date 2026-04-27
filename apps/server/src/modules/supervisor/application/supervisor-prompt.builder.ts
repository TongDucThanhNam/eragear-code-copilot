import type {
  SupervisorPermissionSnapshot,
  SupervisorTurnSnapshot,
} from "./ports/supervisor-decision.port";

const MAX_PERMISSION_CONTEXT_CHARS = 4000;
const MAX_LATEST_TEXT_PART_CHARS = 8000;
const MAX_PROJECT_BLUEPRINT_CHARS = 2500;
const MAX_MEMORY_SNIPPET_CHARS = 800;
const MAX_FOLLOW_UP_BLUEPRINT_CHARS = 1800;
const MAX_FOLLOW_UP_MEMORY_CHARS = 1200;
const MAX_RESEARCH_HIGHLIGHT_CHARS = 1200;
const MAX_LAST_ERROR_SUMMARY_CHARS = 1200;

export const SUPERVISOR_TURN_SYSTEM_PROMPT = [
  "You are a server-side supervisor for an ACP coding agent.",
  "You do not edit files or run shell commands directly.",
  "You may only decide whether the ACP session is done, needs another prompt, needs the human user, or must abort.",
  "If continuing, write one concrete follow-up prompt for the agent. Keep it task-focused and do not ask for hidden chain of thought.",
  "When the auto-resume signal says confirmation_needed, prefer continue unless the latest text part contains a real blocker requiring the human user.",
  "When the auto-resume signal says option_selection_needed, choose one safe listed option and continue. Do not ask the human to propose a new task when a listed option can move the session forward.",
  "Avoid choosing commit, push, deploy, destructive, or credential-related options unless the human explicitly requested that action.",
  "Use the project blueprint and local memory as guardrails. Do not change runtime, framework, database, deployment target, or architecture unless the user explicitly requested it.",
  "Stop when the latest assistant text part indicates the requested task is genuinely complete or when continuing would be repetitive or unsafe.",
].join("\n");

export const SUPERVISOR_PERMISSION_SYSTEM_PROMPT = [
  "You are a permission supervisor for an ACP coding agent.",
  "Approve only when the requested operation is necessary, scoped to the task, and appears safe.",
  "Reject unsafe, destructive, credential-seeking, or unrelated operations.",
  "Defer when the available options do not permit a safe least-privilege decision.",
].join("\n");

export function buildSupervisorTurnPrompt(
  snapshot: SupervisorTurnSnapshot
): string {
  const plan = snapshot.plan?.entries
    .map((entry) => `- [${entry.status}] ${entry.content}`)
    .join("\n");
  const research = snapshot.researchResults
    .map((result, index) => {
      const highlights = result.highlights
        .map((highlight) =>
          truncateText(highlight, MAX_RESEARCH_HIGHLIGHT_CHARS)
        )
        .join("\n");
      return `${index + 1}. ${result.title}\nURL: ${result.url}${
        result.publishedDate ? `\nPublished: ${result.publishedDate}` : ""
      }${highlights ? `\nHighlights:\n${highlights}` : ""}`;
    })
    .join("\n\n");
  const memory = snapshot.memoryResults
    .map((result, index) => {
      const snippets = result.snippets
        .map((snippet) => truncateText(snippet, MAX_MEMORY_SNIPPET_CHARS))
        .join("\n");
      return `${index + 1}. ${result.title}${
        result.path ? `\nPath: ${result.path}` : ""
      }${snippets ? `\nSnippets:\n${snippets}` : ""}`;
    })
    .join("\n\n");
  return [
    `Chat: ${snapshot.chatId}`,
    `Project root: ${snapshot.projectRoot}`,
    `ACP stop reason: ${snapshot.stopReason}`,
    `Supervisor continuation count: ${
      snapshot.supervisor.continuationCount ?? 0
    }`,
    "",
    "Task goal:",
    snapshot.taskGoal || "(unknown)",
    "",
    "Latest assistant text part:",
    truncateText(
      snapshot.latestAssistantTextPart,
      MAX_LATEST_TEXT_PART_CHARS
    ) || "(none)",
    "",
    "Auto-resume signal:",
    snapshot.autoResumeSignal || "(none)",
    "",
    "Recent tool call summary:",
    snapshot.recentToolCallSummary
      ? [
          `Last tools: ${
            snapshot.recentToolCallSummary.lastNToolNames.join(", ") || "(none)"
          }`,
          `Consecutive failures: ${snapshot.recentToolCallSummary.consecutiveFailures}`,
        ].join("\n")
      : "(none)",
    "",
    "Last error summary:",
    snapshot.lastErrorSummary
      ? truncateText(snapshot.lastErrorSummary, MAX_LAST_ERROR_SUMMARY_CHARS)
      : "(none)",
    "",
    "Important:",
    "Only the latest assistant text part and compact recent tool/error summaries are provided to reduce supervisor token usage. Do not infer hidden prior details beyond the task goal, current plan, latest text part, and these summaries.",
    "",
    "Project blueprint:",
    snapshot.projectBlueprint
      ? truncateText(snapshot.projectBlueprint, MAX_PROJECT_BLUEPRINT_CHARS)
      : "(not configured)",
    "",
    "Local memory context:",
    memory || "(not used)",
    "",
    "Current plan:",
    plan || "(none)",
    "",
    "Optional web research:",
    research || "(not used)",
    "",
    "Return a structured decision. Use done only if the user task is complete. Use continue only with a specific follow-up prompt. Use needs_user for missing credentials, missing product choices, external approvals, or ambiguous requirements. Use abort for unsafe or repeated failure states.",
  ].join("\n");
}

export function buildSupervisorFollowUpPrompt(params: {
  followUpPrompt: string;
  projectBlueprint?: string;
  memoryResults: SupervisorTurnSnapshot["memoryResults"];
}): string {
  const memory = params.memoryResults
    .map((result) => {
      const snippets = result.snippets.join(" ");
      return `${result.title}${result.path ? ` (${result.path})` : ""}: ${
        snippets || "(no snippet)"
      }`;
    })
    .join("\n");

  return [
    "Supervisor auto-resume:",
    "The previous phase has been reviewed. Continue the original user task using the existing project architecture and tech stack. Do not change runtime, framework, database, deployment target, or architectural direction unless the user explicitly requested it.",
    "",
    "Instruction:",
    params.followUpPrompt,
    "",
    "Project blueprint:",
    params.projectBlueprint
      ? truncateText(params.projectBlueprint, MAX_FOLLOW_UP_BLUEPRINT_CHARS)
      : "(not configured; follow existing repository conventions)",
    "",
    "Relevant local memory:",
    memory ? truncateText(memory, MAX_FOLLOW_UP_MEMORY_CHARS) : "(none)",
  ].join("\n");
}

export function buildSupervisorPermissionPrompt(
  snapshot: SupervisorPermissionSnapshot
): string {
  const options = snapshot.options
    .map((option) => {
      return `- id=${option.optionId}; kind=${option.kind}; name=${option.name}`;
    })
    .join("\n");
  return [
    `Chat: ${snapshot.chatId}`,
    "Task goal:",
    snapshot.taskGoal || "(unknown)",
    "",
    `Permission request: ${snapshot.requestId}`,
    `Tool call id: ${snapshot.toolCallId ?? "(unknown)"}`,
    `Tool name: ${snapshot.toolName ?? "(unknown)"}`,
    `Title: ${snapshot.title ?? "(none)"}`,
    "Project blueprint:",
    snapshot.projectBlueprint
      ? truncateText(snapshot.projectBlueprint, MAX_PROJECT_BLUEPRINT_CHARS)
      : "(not configured)",
    "",
    "Input:",
    truncateText(safeJson(snapshot.input), MAX_PERMISSION_CONTEXT_CHARS),
    "Metadata:",
    truncateText(safeJson(snapshot.meta), MAX_PERMISSION_CONTEXT_CHARS),
    "Available options:",
    options || "(none)",
    "",
    "Return approve only when a one-time, least-privilege allow option can be selected. Prefer reject over approve when the operation is destructive, persistent, outside project scope, credential-related, or unrelated. Use defer if safe approval/rejection cannot be represented by the available options.",
  ].join("\n");
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated]`;
}

function safeJson(value: unknown): string {
  if (value === undefined) {
    return "(undefined)";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}
