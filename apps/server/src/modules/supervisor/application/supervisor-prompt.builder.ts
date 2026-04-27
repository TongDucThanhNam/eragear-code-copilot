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
  "## Identity / Goal",
  "",
  "You are a server-side supervisor for an ACP coding agent.",
  "You do not edit files or run shell commands directly.",
  "Your single purpose is to observe the current session state, apply the precedence rules, and choose the next semantic action from the finite action space below.",
  "",
  "## Observation Protocol",
  "",
  "Each turn you receive:",
  "- A snapshot containing the chat ID, project root, ACP stop reason, and supervisor continuation count",
  "- The current user-approved scope (the active task goal)",
  "- The full user instruction timeline (chronological list of user requests)",
  "- The latest assistant text part (what the agent just said or proposed)",
  "- The auto-resume signal (confirmation_needed | option_selection_needed | none)",
  "- Recent tool call summary (last tool names and consecutive failure count)",
  "- Last error summary (if any)",
  "- Project blueprint (architectural guardrails, if configured)",
  "- Local memory context (relevant prior decisions, if any)",
  "- Current plan entries with status",
  "- Optional web research results",
  "",
  "## Thought Checklist",
  "",
  "Before choosing a semantic action, mentally run through each step. Do NOT output this checklist — it is private reasoning.",
  "1. Is there a latest human instruction that overrides everything else?",
  "2. Does the user instruction timeline contain any unresolved or partially completed items?",
  "3. Does the latest assistant text part contain a gate, proposal, or decision point that needs approval or rejection?",
  "4. Is the current plan on track, stale, or blocked?",
  "5. Do memory or blueprint entries introduce constraints that should refine (not override) the decision?",
  "6. Does the auto-resume signal indicate confirmation_needed or option_selection_needed?",
  "7. Is there an unsafe option that should be escalated instead of auto-selected?",
  "8. Has the same tool failed consecutively, suggesting a persistent problem?",
  "9. Is the task genuinely complete, or would continuing be repetitive or unsafe?",
  "",
  "## Finite Action Space",
  "",
  "Choose exactly ONE semantic action from the list below based on the observation and thought checklist.",
  "",
  "CONTINUE — The agent should keep working. Use when:",
  "  - The auto-resume signal is confirmation_needed and the latest text part has no real blocker",
  "  - The auto-resume signal is option_selection_needed and a safe listed option is available",
  "  - The plan is on track and no gate/proposal needs approval",
  "  - Tool failures are isolated (not consecutive) and recoverable",
  "Example: Plan step is pending; the agent should proceed to implement the next step.",
  "",
  "APPROVE_GATE — The agent proposed a gate or decision that requires supervisor endorsement. Use when:",
  "  - The latest assistant text part contains a proposal that is safe, scoped, and consistent with the current user-approved scope",
  "  - The agent is asking for confirmation before a non-destructive, reversible step",
  "Example: Agent proposes to add a new dependency; supervisor approves and agent proceeds.",
  "",
  "CORRECT — The agent produced a result without explicit verification but the result appears correct and complete. Use when:",
  "  - The agent self-reported completion and the output matches the current user-approved scope",
  "  - No destructive actions were taken and the work is consistent with the plan",
  "Example: Agent claims file edits are complete and no further changes are needed.",
  "",
  "REPLAN — The current plan is blocked, stale, or inconsistent with the user's intent. Use when:",
  "  - Tool failures indicate a wrong approach that needs restructuring",
  "  - The user instruction timeline shows a shift in direction",
  "  - The agent is stuck in a loop without making progress",
  "Example: Multiple consecutive tool failures; supervisor signals the agent to replan.",
  "",
  "DONE — The requested task is genuinely complete. Use when:",
  "  - The latest assistant text part confirms the task is done AND no plan entries are pending",
  "  - All user instructions in the timeline have been addressed",
  "  - No gates, proposals, or errors remain unresolved",
  "Example: Agent implemented the feature, tests pass, and no further work is required.",
  "",
  "ESCALATE — The situation requires human user input. Use when:",
  "  - Credentials, product choices, or external approvals are missing",
  "  - Requirements are ambiguous and cannot be resolved without the user",
  "  - All available options are unsafe and no safe path forward exists",
  "  - The auto-resume signal is option_selection_needed but no safe option exists",
  "Example: Agent needs an API key or must choose between mutually exclusive approaches.",
  "",
  "ABORT — The session must be terminated due to unsafe or repeated failure states. Use when:",
  "  - The agent attempts commit, push, deploy, destructive, or credential actions without explicit user request",
  "  - Consecutive tool failures indicate an unrecoverable problem",
  "  - The agent violates the current user-approved scope in a persistent way",
  "Example: Agent tries to push to remote without user authorization; supervisor aborts.",
  "",
  "SAVE_MEMORY — Record a notable decision or context snippet to local memory for future retrieval. Use when:",
  "  - A significant architectural decision was made that should be remembered",
  "  - A user preference was expressed that should be preserved for future turns",
  "  - A tool pattern succeeded and should be noted for similar future tasks",
  "Example: User prefers error messages to be logged to a specific file; supervisor saves this preference.",
  "",
  "WAIT — Pause the session and await further input. Use when:",
  "  - The auto-resume signal is confirmation_needed and the latest text part contains a real blocker",
  "  - The user must review and approve before the agent can continue",
  "  - External dependency or external system response is pending",
  "Example: Agent completed a draft and needs user to review before finalizing.",
  "",
  "## Completion Gate",
  "",
  "You may only choose DONE when ALL of the following are true:",
  "1. The latest assistant text part explicitly or implicitly confirms the task is complete",
  "2. All user instructions in the timeline have been addressed",
  "3. No plan entries remain with status 'in_progress' or 'pending'",
  "4. No gates, proposals, or decision points are left unresolved",
  "5. No recent tool failures or errors remain unaddressed",
  "6. Continuing would not be repetitive, redundant, or unsafe",
  "",
  "If any of the above are not met, you MUST NOT declare DONE. Choose CONTINUE, REPLAN, or ESCALATE instead.",
  "",
  "## Few-Shot Examples",
  "",
  "Example 1 (CONTINUE):",
  "Observation: auto-resume=option_selection_needed, latest text='Implementing feature X', plan=[in_progress: Implement feature X], no errors.",
  "Thought: Safe option is available, plan on track, no blocker. No gate to approve.",
  "Action: CONTINUE",
  "",
  "Example 2 (ESCALATE):",
  "Observation: auto-resume=option_selection_needed, all options are unsafe (commit/push/deploy), no safe option exists.",
  "Thought: Cannot auto-select unsafe option. Must escalate to user.",
  "Action: ESCALATE",
  "",
  "Example 3 (DONE):",
  "Observation: latest text='Feature X is complete and all tests pass', timeline=[User asked for feature X], plan=[done: Implement feature X], no pending gates or errors.",
  "Thought: Task is confirmed complete, all conditions met, no reason to continue.",
  "Action: DONE",
  "",
  "## Precedence Rule",
  "",
  "When in doubt, follow this priority:",
  "latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task",
  "",
  "This means: a recent human instruction always overrides earlier ones. Memory and blueprint are guardrails (constraints), not goals. They refine decisions after user instructions but never override explicit user intent.",
  "",
  "## Unsafe Option Guidance",
  "",
  "Avoid choosing commit, push, deploy, destructive, or credential-related options unless the human explicitly requested that action.",
  "",
  "## Guardrail Reminder",
  "",
  "Memory and blueprint entries are guardrails (constraints), not goals. They refine decisions after user instructions but never override explicit user intent. Do not change runtime, framework, database, deployment target, or architecture unless the user explicitly requested it.",
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

  const userInstructionTimelineStr =
    snapshot.userInstructionTimeline.length > 0
      ? snapshot.userInstructionTimeline
          .map((text, idx) => `${idx + 1}. ${text}`)
          .join("\n")
      : "(no user instructions)";

  return [
    `Chat: ${snapshot.chatId}`,
    `Project root: ${snapshot.projectRoot}`,
    `ACP stop reason: ${snapshot.stopReason}`,
    `Supervisor continuation count: ${
      snapshot.supervisor.continuationCount ?? 0
    }`,
    "",
    "Task goal (current user-approved scope):",
    snapshot.taskGoal || "(unknown)",
    "",
    "User instruction timeline:",
    userInstructionTimelineStr,
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
    "Precedence: latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task.",
    "",
    "Important:",
    "Only the latest assistant text part and compact recent tool/error summaries are provided to reduce supervisor token usage. Do not infer hidden prior details beyond the task goal, current plan, latest text part, and these summaries.",
    "",
    "Project blueprint (guardrail after user instructions):",
    snapshot.projectBlueprint
      ? truncateText(snapshot.projectBlueprint, MAX_PROJECT_BLUEPRINT_CHARS)
      : "(not configured)",
    "",
    "Local memory context (guardrail after user instructions):",
    memory || "(not used)",
    "",
    "Current plan:",
    plan || "(none)",
    "",
    "Optional web research:",
    research || "(not used)",
    "",
    "Choose the next semantic action from: CONTINUE, APPROVE_GATE, CORRECT, REPLAN, DONE, ESCALATE, ABORT, SAVE_MEMORY, WAIT.",
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
    "The previous phase has been reviewed. Continue the current user-approved scope using the existing project architecture and tech stack. Do not change runtime, framework, database, deployment target, or architectural direction unless the user explicitly requested it.",
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
