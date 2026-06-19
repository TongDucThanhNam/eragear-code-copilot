import type * as acp from "@agentclientprotocol/sdk";
import type { Plan } from "#runtime/modules/session/domain/stored-session.types";
import type {
  SupervisorSemanticDecision,
  SupervisorSessionState,
} from "#runtime/shared/types/supervisor.types";
import type { SupervisorPermissionDecision } from "../supervisor.schemas";
import type {
  SupervisorMemoryResult,
  SupervisorProjectMemoryConfig,
} from "./supervisor-memory.port";
import type { SupervisorResearchResult } from "./supervisor-research.port";

/**
 * Heuristic signal that decides whether supervisor can continue without user input.
 *
 * Caller contract: values are advisory context for the decision adapter; they
 * do not override explicit permission or confirmation requirements.
 */
export type SupervisorAutoResumeSignal =
  | "phase_complete"
  | "confirmation_needed"
  | "option_selection_needed";

/**
 * Bounded summary of recent tool activity.
 *
 * Invariant: this contains names/counts only, not raw tool arguments or
 * sensitive command output.
 */
export interface SupervisorRecentToolCallSummary {
  lastNToolNames: string[];
  consecutiveFailures: number;
}

/**
 * Complete decision input for one assistant turn.
 *
 * Security contract: callers must cap/truncate user and assistant text before
 * building this snapshot because decision adapters may call external models.
 */
export interface SupervisorTurnSnapshot {
  chatId: string;
  projectRoot: string;
  stopReason: string;
  /** Current task goal — derived from the latest user instruction for routing decisions */
  taskGoal: string;
  latestAssistantTextPart: string;
  /** First user message in the conversation — preserved for backward compatibility */
  originalTaskGoal: string;
  /** Last user instruction — the latest explicit user scope */
  latestUserInstruction: string;
  /** All user messages in chronological order, truncated and capped for bounded payload */
  userInstructionTimeline: string[];
  autoResumeSignal?: SupervisorAutoResumeSignal;
  recentToolCallSummary?: SupervisorRecentToolCallSummary;
  lastErrorSummary?: string;
  projectBlueprint?: string;
  projectMemory?: SupervisorProjectMemoryConfig;
  memoryResults: SupervisorMemoryResult[];
  memoryLookupCommands?: string[];
  plan?: Plan;
  supervisor: SupervisorSessionState;
  researchResults: SupervisorResearchResult[];
}

/**
 * Decision input for one ACP permission request.
 *
 * Caller contract: raw `input`/`meta` may contain tool details, so adapters must
 * apply their own redaction policy before external logging or model calls.
 */
export interface SupervisorPermissionSnapshot {
  chatId: string;
  taskGoal: string;
  projectBlueprint?: string;
  requestId: string;
  toolCallId?: string;
  toolName?: string;
  title?: string;
  input?: unknown;
  meta?: unknown;
  options: acp.PermissionOption[];
  supervisor: SupervisorSessionState;
}

/**
 * Supervisor decision adapter port.
 *
 * Error mode: adapters may reject when no model/provider is configured; the
 * supervisor loop must treat that as unavailable supervision, not as user denial.
 */
export interface SupervisorDecisionPort {
  decideTurn(
    input: SupervisorTurnSnapshot
  ): Promise<SupervisorSemanticDecision>;
  decidePermission(
    input: SupervisorPermissionSnapshot
  ): Promise<SupervisorPermissionDecision>;
}
