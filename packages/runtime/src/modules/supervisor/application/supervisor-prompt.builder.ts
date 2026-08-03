import type { SupervisorChatSnapshot } from "./ports/supervisor-chat.port";
import type {
  SupervisorPermissionSnapshot,
  SupervisorTurnSnapshot,
} from "./ports/supervisor-decision.port";
import type { SupervisorPolicy } from "./supervisor-policy";

const MAX_PERMISSION_CONTEXT_CHARS = 4000;
const MAX_LATEST_TEXT_PART_CHARS = 8000;
const MAX_PROJECT_BLUEPRINT_CHARS = 2500;
const MAX_MEMORY_SNIPPET_CHARS = 800;
const MAX_FOLLOW_UP_BLUEPRINT_CHARS = 1800;
const MAX_FOLLOW_UP_MEMORY_CHARS = 1200;
const MAX_FOLLOW_UP_RESEARCH_CHARS = 1600;
const MAX_FOLLOW_UP_RESEARCH_HIGHLIGHT_CHARS = 500;
const MAX_RESEARCH_HIGHLIGHT_CHARS = 1200;
const MAX_LAST_ERROR_SUMMARY_CHARS = 1200;

function formatCommandList(commands: string[]): string {
  return commands.map((command) => `- \`${command}\``).join("\n");
}

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
  "## Follow-up Prompt Style",
  "",
  "When your semantic action requires followUpPrompt, write it like a concise human approval or steering message to the coding agent, not like an internal control packet.",
  'For safe approval gates, start naturally with wording like: "Yes, please ..."',
  "Name the concrete option or scoped fix being approved, include the key guardrail, and ask for verification evidence.",
  "When current package docs, exports, versions, or external APIs matter, tell the agent to use available `exa-search` / web-search tools before choosing the implementation.",
  "When project-specific decisions or prior context matter, tell the agent to use Obsidian/local memory context before choosing the implementation.",
  'Do not output vague prompts such as only "continue" or "proceed". The follow-up must be actionable without the hidden supervisor reasoning.',
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

export const SUPERVISOR_CHAT_SYSTEM_PROMPT = [
  "You are Supervisos, the dedicated side-chat supervisor agent for an ACP coding session.",
  "You speak directly with the human user in a separate Supervisos panel.",
  "You do not edit files, run shell commands, or approve ACP permissions from this side chat.",
  "When runtime delegation is available and the user asks for implementation, Supervisos may submit an enhanced prompt to the main coding agent through the existing session pipeline; otherwise you can explain current supervisor state, review compact Goal Mode context, identify gates, recommend the next safe action, and draft a concise follow-up.",
  "Preserve ACP permission boundaries: destructive actions, file deletion, credential access, verification failures, and scope drift require explicit human approval through the existing session controls.",
  "Never claim you used tools or inspected files unless the compact context explicitly says so.",
  "Never ask for or reveal API keys or secrets.",
  "Do not rely on hidden transcript details. Only use the compact side-chat history, supervisor state, project context snapshot, precomputed project intelligence, current plan, and Goal Mode summaries provided in the prompt.",
  "Treat project intelligence as precomputed tool results from resolve_scope, ast_import_graph_context, and search_symbols. Do not pretend you ran additional tools.",
  "Do not output hidden reasoning, chain-of-thought, XML-like thinking tags, or `<think>` blocks. Return only the final user-facing answer.",
  "Prefer concrete answers over process narration. If something is not configured or unavailable, say exactly what is missing and what the next safe step is.",
].join("\n");

export function buildSupervisorTurnSystemPrompt(
  policy?: Pick<
    SupervisorPolicy,
    "customSystemPrompt" | "toolAllowlist" | "toolPolicy"
  >
): string {
  return appendSupervisorAgentProfile(SUPERVISOR_TURN_SYSTEM_PROMPT, policy);
}

export function buildSupervisorPermissionSystemPrompt(
  policy?: Pick<
    SupervisorPolicy,
    "customSystemPrompt" | "toolAllowlist" | "toolPolicy"
  >
): string {
  return appendSupervisorAgentProfile(
    SUPERVISOR_PERMISSION_SYSTEM_PROMPT,
    policy
  );
}

export function buildSupervisorChatSystemPrompt(
  policy?: Pick<
    SupervisorPolicy,
    "customSystemPrompt" | "toolAllowlist" | "toolPolicy"
  >
): string {
  return appendSupervisorAgentProfile(SUPERVISOR_CHAT_SYSTEM_PROMPT, policy);
}

function appendSupervisorAgentProfile(
  basePrompt: string,
  policy?: Pick<
    SupervisorPolicy,
    "customSystemPrompt" | "toolAllowlist" | "toolPolicy"
  >
): string {
  const profile = formatSupervisorAgentProfile(policy);
  return profile ? `${basePrompt}\n\n${profile}` : basePrompt;
}

function formatSupervisorAgentProfile(
  policy?: Pick<
    SupervisorPolicy,
    "customSystemPrompt" | "toolAllowlist" | "toolPolicy"
  >
): string {
  if (!policy) {
    return "";
  }
  const sections = ["## Configured Supervisor Agent Profile"];
  const customSystemPrompt = policy.customSystemPrompt?.trim();
  if (customSystemPrompt) {
    sections.push("", "Custom system instructions:", customSystemPrompt);
  }

  const toolAllowlist = [...new Set(policy.toolAllowlist ?? [])]
    .map((tool) => tool.trim())
    .filter(Boolean);
  let toolPolicyText =
    "Use built-in supervisor context providers and only steer the coding agent toward tools already available in the active chat/session.";
  if (policy.toolPolicy === "custom-allowlist") {
    toolPolicyText =
      toolAllowlist.length > 0
        ? `When asking the coding agent to use tools, only name these tools: ${toolAllowlist.join(", ")}.`
        : "Custom allowlist is active but empty; do not request tool-specific actions.";
  }
  sections.push("", "Tool steering policy:", toolPolicyText);

  return sections.join("\n");
}

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
  const projectMemory = snapshot.projectMemory
    ? [
        snapshot.projectMemory.obsidianProjectPath
          ? `Obsidian project path: ${snapshot.projectMemory.obsidianProjectPath}`
          : "",
        snapshot.projectMemory.techStackTags.length > 0
          ? `Tech stack tags: ${snapshot.projectMemory.techStackTags.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

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
    "Project memory config:",
    projectMemory || "(not configured)",
    "",
    "Supervisor memory commands already run:",
    snapshot.memoryLookupCommands?.length
      ? formatCommandList(snapshot.memoryLookupCommands)
      : "(none)",
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

export function buildSupervisorChatPrompt(
  snapshot: SupervisorChatSnapshot
): string {
  const plan = snapshot.plan?.entries
    .map((entry) => `- [${entry.status}] ${entry.content}`)
    .join("\n");
  const history = snapshot.sideChatHistory
    .slice(-12)
    .map((message) => {
      const speaker = message.role === "assistant" ? "Supervisos" : "User";
      return `${speaker}: ${truncateText(message.content, 1200)}`;
    })
    .join("\n\n");
  const audit = snapshot.goalModeAudit
    .map((entry, index) => {
      return [
        `${index + 1}. ${entry.phaseId}`,
        `kind=${entry.kind}`,
        entry.decision ? `decision=${entry.decision}` : "",
        entry.summary ? `summary=${truncateText(entry.summary, 500)}` : "",
        entry.targetPath ? `target=${entry.targetPath}` : "",
        entry.verification
          ? `verification=${truncateText(entry.verification, 500)}`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
    })
    .join("\n");
  const projectFiles = snapshot.projectContext.files
    .map((file, index) => {
      return `${index + 1}. ${file.path} (${file.kind})\n${truncateText(file.excerpt, 1200)}`;
    })
    .join("\n\n");
  const projectIntelligence = formatProjectIntelligence(snapshot);

  return [
    `Chat: ${snapshot.chatId}`,
    snapshot.projectId ? `Project id: ${snapshot.projectId}` : "",
    `Project root: ${snapshot.projectRoot}`,
    "",
    "Project context snapshot:",
    snapshot.projectContext.topLevelEntries.length > 0
      ? `Top-level entries: ${snapshot.projectContext.topLevelEntries.join(", ")}`
      : "Top-level entries: (none)",
    projectFiles ? `Context files:\n${projectFiles}` : "Context files: (none)",
    snapshot.projectContext.diagnostics.length > 0
      ? `Diagnostics: ${snapshot.projectContext.diagnostics.join("; ")}`
      : "Diagnostics: (none)",
    "",
    "Precomputed project intelligence tools:",
    projectIntelligence,
    "",
    "Supervisor state:",
    `- mode: ${snapshot.supervisor.mode}`,
    `- status: ${snapshot.supervisor.status}`,
    `- reason: ${snapshot.supervisor.reason ?? "(none)"}`,
    `- continuation count: ${snapshot.supervisor.continuationCount ?? 0}`,
    snapshot.supervisor.lastDecision
      ? `- last decision: ${snapshot.supervisor.lastDecision.action} (${snapshot.supervisor.lastDecision.reason})`
      : "- last decision: (none)",
    "",
    "Current plan:",
    plan || "(none)",
    "",
    "Recent Goal Mode audit summaries:",
    audit || "(none)",
    "",
    "Prior Supervisos side-chat messages:",
    history || "(none)",
    "",
    "User asks Supervisos:",
    truncateText(snapshot.userMessage, 6000),
    "",
    "Reply as Supervisos in the side chat. Be direct and operational. If the user is asking why Supervisos is idle/off, distinguish configuration, autopilot mode, and active review status. If the user asks for the next action, give one concrete safe action and the reason.",
  ].join("\n");
}

function formatProjectIntelligence(snapshot: SupervisorChatSnapshot): string {
  const intelligence = snapshot.projectIntelligence;
  const scope = intelligence.scope
    ? [
        `resolve_scope: ${intelligence.scope.resolverVersion}; symbolExtraction=${intelligence.symbolExtractionMode}; resolvedViaLLM=${intelligence.scope.resolvedViaLLM}`,
        `primary: ${formatScopeTarget(intelligence.scope.primaryTarget)}`,
        intelligence.scope.secondaryTargets.length > 0
          ? `secondary: ${intelligence.scope.secondaryTargets
              .map(formatScopeTarget)
              .join(" | ")}`
          : "secondary: (none)",
        intelligence.scope.graphConfidence !== undefined
          ? `graphConfidence: ${intelligence.scope.graphConfidence}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : `resolve_scope: ${intelligence.status}`;
  const graphNodes = intelligence.graphNodes
    .map((node, index) => {
      const symbols = node.symbols
        .map((symbol) => `${symbol.name}:${symbol.kind}@${symbol.line}`)
        .join(", ");
      return [
        `${index + 1}. ${node.path}`,
        `workspace=${node.workspace}`,
        node.routeKey ? `route=${node.routeKey}` : "",
        `reachable=${node.reachableFromRoots}`,
        node.imports.length ? `imports=[${node.imports.join(", ")}]` : "",
        node.importedBy.length
          ? `importedBy=[${node.importedBy.join(", ")}]`
          : "",
        node.exports.length ? `exports=[${node.exports.join(", ")}]` : "",
        symbols ? `symbols=[${symbols}]` : "",
      ]
        .filter(Boolean)
        .join("; ");
    })
    .join("\n");
  const symbolMatches = intelligence.symbolMatches
    .map((symbol, index) => {
      return `${index + 1}. ${symbol.name} (${symbol.kind}) in ${symbol.path}:${symbol.line} via ${symbol.source}`;
    })
    .join("\n");
  const routeMap = intelligence.routeMap
    .map((route, index) => {
      return `${index + 1}. ${route.routeKey} -> ${route.path}${
        route.exportedSymbols.length
          ? ` exports ${route.exportedSymbols.join(", ")}`
          : ""
      }`;
    })
    .join("\n");

  return [
    `status: ${intelligence.status}`,
    scope,
    "",
    "ast_import_graph_context:",
    graphNodes || "(none)",
    "",
    "search_symbols:",
    symbolMatches || "(none)",
    "",
    "route_map:",
    routeMap || "(none)",
    "",
    intelligence.diagnostics.length > 0
      ? `diagnostics: ${intelligence.diagnostics.join("; ")}`
      : "diagnostics: (none)",
  ].join("\n");
}

function formatScopeTarget(target: {
  path: string;
  score: number;
  reason: string;
}): string {
  return `${target.path} score=${target.score} reason=${truncateText(
    target.reason,
    240
  )}`;
}

export function buildSupervisorFollowUpPrompt(params: {
  followUpPrompt: string;
  projectBlueprint?: string;
  projectMemory?: SupervisorTurnSnapshot["projectMemory"];
  memoryResults: SupervisorTurnSnapshot["memoryResults"];
  memoryLookupCommands?: SupervisorTurnSnapshot["memoryLookupCommands"];
  researchResults?: SupervisorTurnSnapshot["researchResults"];
}): string {
  const memory = params.memoryResults
    .map((result) => {
      const snippets = result.snippets.join(" ");
      return `${result.title}${result.path ? ` (${result.path})` : ""}: ${
        snippets || "(no snippet)"
      }`;
    })
    .join("\n");
  const research = (params.researchResults ?? [])
    .map((result, index) => {
      const highlights = result.highlights
        .map((highlight) =>
          truncateText(highlight, MAX_FOLLOW_UP_RESEARCH_HIGHLIGHT_CHARS)
        )
        .join(" ");
      return `${index + 1}. ${result.title} (${result.url})${
        highlights ? `: ${highlights}` : ""
      }`;
    })
    .join("\n");
  const projectMemory = params.projectMemory
    ? [
        params.projectMemory.obsidianProjectPath
          ? `Obsidian project path: ${params.projectMemory.obsidianProjectPath}`
          : "",
        params.projectMemory.techStackTags.length > 0
          ? `Tech stack tags: ${params.projectMemory.techStackTags.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const readHints = params.memoryResults
    .flatMap((result) => (result.path ? [result.path] : []))
    .slice(0, 5)
    .map((notePath) => `obsidian read path=${notePath}`);
  let usefulObsidianReads = "(none)";
  if (readHints.length > 0) {
    usefulObsidianReads = formatCommandList(readHints);
  } else if (params.projectMemory?.obsidianProjectPath) {
    usefulObsidianReads = `- \`obsidian files folder=${params.projectMemory.obsidianProjectPath}\``;
  }

  return [
    "Yes, please proceed with the scoped follow-up below.",
    "",
    "Request:",
    params.followUpPrompt,
    "",
    "Guardrails:",
    "- Keep the work inside the current user-approved scope and existing repository architecture.",
    "- Do not change runtime, framework, database, deployment target, or architectural direction unless the human explicitly requested it.",
    "- Do not commit, push, deploy, or perform destructive actions unless the human explicitly requested them.",
    "- Use available `exa-search` / web-search tools when current package docs, exports, versions, or external APIs affect the fix.",
    "- Use Obsidian/local memory context for project-specific decisions or prior constraints before choosing an approach.",
    "- Finish with objective verification evidence: files changed and commands/tests run.",
    "",
    "Project memory config:",
    projectMemory || "(not configured)",
    "",
    "Supervisor context already gathered:",
    params.memoryLookupCommands?.length
      ? formatCommandList(params.memoryLookupCommands)
      : "(no Obsidian lookup commands recorded)",
    "",
    "Useful Obsidian follow-up reads if you need deeper context:",
    usefulObsidianReads,
    "",
    "Project blueprint:",
    params.projectBlueprint
      ? truncateText(params.projectBlueprint, MAX_FOLLOW_UP_BLUEPRINT_CHARS)
      : "(not configured; follow existing repository conventions)",
    "",
    "Relevant local memory:",
    memory ? truncateText(memory, MAX_FOLLOW_UP_MEMORY_CHARS) : "(none)",
    "",
    "Relevant web research:",
    research ? truncateText(research, MAX_FOLLOW_UP_RESEARCH_CHARS) : "(none)",
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
