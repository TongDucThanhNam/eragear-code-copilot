import type * as acp from "@agentclientprotocol/sdk";
import type { Plan } from "@/modules/session/domain/stored-session.types";
import type {
  SupervisorSemanticDecision,
  SupervisorSessionState,
} from "@/shared/types/supervisor.types";
import type { SupervisorPermissionDecision } from "../supervisor.schemas";
import type { SupervisorMemoryResult } from "./supervisor-memory.port";
import type { SupervisorResearchResult } from "./supervisor-research.port";

export type SupervisorAutoResumeSignal =
  | "phase_complete"
  | "confirmation_needed"
  | "option_selection_needed";

export interface SupervisorRecentToolCallSummary {
  lastNToolNames: string[];
  consecutiveFailures: number;
}

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
  memoryResults: SupervisorMemoryResult[];
  plan?: Plan;
  supervisor: SupervisorSessionState;
  researchResults: SupervisorResearchResult[];
}

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

export interface SupervisorDecisionPort {
  decideTurn(input: SupervisorTurnSnapshot): Promise<SupervisorSemanticDecision>;
  decidePermission(
    input: SupervisorPermissionSnapshot
  ): Promise<SupervisorPermissionDecision>;
}
