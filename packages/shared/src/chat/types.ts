import type {
  DataUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "../ui-message.js";
import type { GoalModeAuditEntry } from "./goal-mode-audit.js";

// ============================================================================
// Chat Status Types
// ============================================================================

/**
 * Chat status matching server's BroadcastEvent chat_status.
 *
 * Covers both session availability and prompt turn lifecycle.
 */
export type ChatStatus =
  | "inactive"
  | "connecting"
  | "ready"
  | "submitted"
  | "streaming"
  | "awaiting_permission"
  | "cancelling"
  | "error";

/** Connection status for subscription lifecycle */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

// ============================================================================
// Session State Types
// ============================================================================

export interface SessionModeState {
  currentModeId: string;
  availableModes: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
}

export interface SessionModelState {
  currentModelId: string;
  availableModels: Array<{
    modelId: string;
    name: string;
    description?: string | null;
    provider?: string;
    providers?: string[];
  }>;
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface AgentInfo {
  name: string;
  title?: string;
  version: string;
}

export type SessionConfigOptionCategory =
  | "mode"
  | "model"
  | "thought_level"
  | string;

export interface SessionConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export interface SessionConfigSelectGroup {
  group: string;
  name: string;
  options: SessionConfigSelectOption[];
}

export interface SessionConfigOptionBase {
  id: string;
  name: string;
  description?: string | null;
  category?: SessionConfigOptionCategory | null;
}

export type SessionConfigOption =
  | (SessionConfigOptionBase & {
      type: "select";
      currentValue: string;
      options: SessionConfigSelectOption[] | SessionConfigSelectGroup[];
    })
  | (SessionConfigOptionBase & {
      type: "boolean";
      currentValue: boolean;
      options?: never;
    });

export interface SessionInfo {
  title?: string | null;
  updatedAt?: string | null;
}

export type SupervisorMode = "off" | "full_autopilot";

export type SupervisorStatus =
  | "idle"
  | "queued"
  | "reviewing"
  | "continuing"
  | "done"
  | "needs_user"
  | "aborted"
  | "error"
  | "disabled";

export type SupervisorDecisionAction =
  | "done"
  | "continue"
  | "needs_user"
  | "abort";

export interface SupervisorDecisionSummary {
  action: SupervisorDecisionAction;
  reason: string;
  followUpPrompt?: string;
}

export interface SupervisorSessionState {
  mode: SupervisorMode;
  status: SupervisorStatus;
  reason?: string;
  runId?: string;
  runStartedAt?: number;
  updatedAt?: number;
  continuationCount?: number;
  lastTurnId?: string;
  lastDecision?: SupervisorDecisionSummary;
}

// ============================================================================
// Permission Types
// ============================================================================

export interface PermissionOption {
  optionId?: string;
  id?: string;
  kind?: string;
  name?: string;
  label?: string;
  description?: string;
}

export type PermissionOptions =
  | PermissionOption[]
  | {
      allowOther?: boolean;
      options?: PermissionOption[];
    };

export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  title: string;
  input?: unknown;
  options?: PermissionOptions;
}

export type SubagentInvocationStatus = "running" | "completed" | "failed";

export interface SubagentInvocation {
  id: string;
  name: string;
  description?: string;
  sourcePath: string;
  status: SubagentInvocationStatus;
  parentChatId: string;
  parentTurnId: string;
  agentSessionId?: string;
  startedAt: number;
  completedAt?: number;
  resultMessageId?: string;
  error?: string;
}

export interface TurnDiffFile {
  path: string;
  oldPath?: string;
  kind: "added" | "modified" | "deleted" | "renamed" | "copied";
  additions: number;
  deletions: number;
}

// ============================================================================
// Broadcast Event Types (matching server's BroadcastEvent)
// ============================================================================

export type BroadcastEvent =
  | { type: "connected" }
  | { type: "chat_status"; status: ChatStatus; turnId?: string }
  | {
      type: "chat_finish";
      stopReason: string;
      finishReason: string;
      messageId?: string;
      message?: UIMessage;
      isAbort: boolean;
      turnId?: string;
    }
  | { type: "ui_message"; message: UIMessage; turnId?: string }
  | {
      type: "ui_message_part";
      messageId: string;
      messageRole: UIMessage["role"];
      partId?: string;
      partIndex: number;
      part: UIMessagePart;
      isNew: boolean;
      createdAt?: number;
      turnId?: string;
    }
  | {
      type: "ui_message_part_removed";
      messageId: string;
      messageRole: UIMessage["role"];
      partId?: string;
      partIndex: number;
      part: UIMessagePart;
      turnId?: string;
    }
  | { type: "file_modified"; path: string }
  | {
      type: "session_reverted";
      turnCount: number;
      replayedMessages: number;
    }
  | {
      type: "prompt_turn_diff_ready";
      turnId: string;
      turnCount: number;
      files: TurnDiffFile[];
    }
  | {
      type: "available_commands_update";
      availableCommands: Array<{
        name: string;
        description: string;
        input?: { hint: string } | null;
      }>;
    }
  | {
      type: "config_options_update";
      configOptions: SessionConfigOption[];
    }
  | {
      type: "session_info_update";
      sessionInfo: SessionInfo;
    }
  | { type: "supervisor_status"; supervisor: SupervisorSessionState }
  | {
      type: "supervisor_decision";
      decision: SupervisorDecisionSummary;
      supervisor: SupervisorSessionState;
      turnId?: string;
    }
  | {
      type: "goal_mode_audit";
      audit: GoalModeAuditEntry;
      turnId?: string;
    }
  | {
      type: "subagent_status";
      invocation: SubagentInvocation;
      turnId?: string;
    }
  | {
      type: "current_mode_update";
      modeId: string;
      reason?: string;
      metadata?: unknown;
    }
  | { type: "current_model_update"; modelId: string }
  | {
      type: "terminal_output";
      terminalId: string;
      data: string;
      turnId?: string;
    }
  | { type: "heartbeat"; ts: number }
  | { type: "error"; error: string };

export interface SupervisorRunClientUpdate {
  runId: string;
  revision: number;
  projectId?: string;
  originatingChatId?: string;
  sourceGoalContract?: {
    intakeId: string;
    revisionId: string;
    revision?: number;
    hash: string;
    createdAt?: string;
    contract?: {
      title: string;
      objective: string;
      lockedStrategicDecisions: string[];
      assumptions: string[];
      nonGoals: string[];
      changeBoundary: string[];
      acceptanceCriteria: Array<{
        criterionId: string;
        statement: string;
        evidence: "machine" | "user";
      }>;
      trustedVerificationCommands: string[];
      authority: {
        scopedCodeChange: "auto" | "ask";
        architectureChange: "auto" | "ask";
        dependencyChange: "auto" | "ask";
        destructiveAction: "ask";
        finalIntegration: "auto" | "ask";
      };
      unresolvedQuestions: string[];
    };
    criterionResolutions: Array<{
      criterionId: string;
      resolution: "user_accepted" | "waived";
      decisionId: string;
      resolvedAt: string;
    }>;
  };
  status:
    | "draft"
    | "planning"
    | "awaiting_approval"
    | "queued"
    | "running"
    | "waiting_capacity"
    | "paused"
    | "needs_user"
    | "completing"
    | "completed"
    | "failed"
    | "cancelled";
  cancellation?: {
    status: "pending" | "running" | "succeeded" | "failed";
    pendingSessionCount: number;
    pendingWorkspaceCount: number;
    blockingDecisionId?: string;
  };
  tasks: Array<{
    taskId: string;
    title: string;
    role: "research" | "implementation" | "test" | "review" | "integration";
    executionMode: "read_only" | "write";
    dependencies: string[];
    criterionIds?: string[];
    changeKinds?: Array<
      | "scoped_code_change"
      | "architecture_change"
      | "dependency_change"
      | "final_integration"
    >;
    preferredModelId?: string;
    status:
      | "blocked"
      | "ready"
      | "queued"
      | "running"
      | "waiting_capacity"
      | "reviewing"
      | "integrating"
      | "completed"
      | "needs_user"
      | "failed"
      | "cancelled";
    attempts: Array<{
      attemptId: string;
      chatId: string;
      agentId: string;
      modelId?: string;
      status:
        | "starting"
        | "running"
        | "waiting_capacity"
        | "terminal"
        | "interrupted";
      files?: {
        touched: string[];
        created: string[];
        deleted: string[];
        renamed: Array<{ from: string; to: string }>;
      };
      verification: Array<{ command: string; exitCode: number | null }>;
    }>;
  }>;
  limits?: {
    maxAttemptsPerTask: number;
  };
  gates: Array<{
    gateId: string;
    taskId: string;
    attemptId: string;
    kind:
      | "scope"
      | "dirty_overlap"
      | "baseline_drift"
      | "deletion"
      | "destructive_action"
      | "verification"
      | "conflict"
      | "non_git_write";
    status: "pending" | "approved" | "rejected";
  }>;
  priority: "urgent" | "high" | "normal" | "low";
  manager?: {
    agentId: string;
    chatId: string;
    status: "creating" | "running" | "stopped" | "waiting_capacity" | "failed";
    exactResumeRequired: true;
  };
  plan?: {
    version: number;
    hash: string;
    summary: string;
    approvedAt?: string;
    envelope: {
      goal: string;
      fileScopes: string[];
      verificationCommands: string[];
      successCriteria: string[];
      permissionScopes: string[];
      destructiveActions: string[];
      delivery: {
        createCommit: true;
        targetBranch: string;
        targetHead: string;
        allowDefaultBranch: boolean;
      };
    };
  };
  capacityWaits: Array<{
    waitId: string;
    owner: "manager" | "task";
    taskId?: string;
    attemptId?: string;
    agentId: string;
    kind:
      | "quota_exhausted"
      | "transient_rate_limit"
      | "auth_required"
      | "transport"
      | "session_fatal"
      | "unknown";
    retryAt: string;
    resetAt?: string;
  }>;
  decisions: Array<{
    decisionId: string;
    kind: string;
    status: "open" | "answered" | "cancelled";
    prompt: string;
    createdAt: string;
    answeredAt?: string;
    criterionIds?: string[];
  }>;
  finalVerification: Array<{ command: string; exitCode: number | null }>;
  finalCommitSha?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Bounded read-only detail view over one persisted supervisor run.
 *
 * The runtime derives this from stored facts per request; it is a projection,
 * never a second truth store. Bounds are enforced runtime-side (see the
 * runtime detail projection) so every array and free-text field here is
 * already truncated with honest totals when it says so. Paths, storage refs,
 * session internals, and secrets are deliberately excluded.
 */
export interface SupervisorRunDetailClientView {
  runId: string;
  revision: number;
  projectId?: string;
  status: SupervisorRunClientUpdate["status"];
  phase: "planning" | "executing" | "finalizing" | "finished";
  desiredState: "running" | "paused" | "cancelled";
  outcome?: "succeeded" | "failed" | "cancelled";
  plannerReplanCount: number;
  /** Bounded copy of the run's original intent for surfaces without a Goal contract. */
  originalIntent?: string;
  createdAt: string;
  updatedAt: string;
  tasks: Array<{
    taskId: string;
    title: string;
    /** Bounded worker prompt for the task. */
    prompt: string;
    role: SupervisorRunClientUpdate["tasks"][number]["role"];
    executionMode: SupervisorRunClientUpdate["tasks"][number]["executionMode"];
    dependencies: string[];
    criterionIds: string[];
    status: SupervisorRunClientUpdate["tasks"][number]["status"];
    outcome?: "succeeded" | "failed" | "cancelled";
    blockingDecisionId?: string;
    notBefore?: string;
    filesAllowed: { paths: string[]; total: number };
    verificationCommands: string[];
    attempts: Array<{
      attemptId: string;
      chatId: string;
      agentId: string;
      modelId?: string;
      status:
        | "starting"
        | "running"
        | "waiting_capacity"
        | "uncertain"
        | "terminal"
        | "interrupted";
      semanticStatus?: "succeeded" | "needs_user" | "failed" | "cancelled";
      startedAt: string;
      finishedAt?: string;
      /** Bounded outcome summary from the worker result. */
      outcomeSummary?: string;
      /** Bounded failure/needs-user reason. */
      reason?: string;
      /** Hash-addressed checkpoint reference; storage paths stay runtime-side. */
      checkpoint?: { sha256: string; byteLength: number };
      files: {
        touched: { paths: string[]; total: number };
        created: { paths: string[]; total: number };
        deleted: { paths: string[]; total: number };
        renamed: Array<{ from: string; to: string }>;
      };
      verification: Array<{
        command: string;
        exitCode: number | null;
        outputSummary?: string;
      }>;
      unresolvedPermissions: string[];
      toolFailureSummary: string[];
      workspace?: {
        kind: "read_only" | "direct_git" | "isolated_git";
        baseHead?: string;
      };
    }>;
  }>;
  gates: Array<{
    gateId: string;
    taskId: string;
    attemptId: string;
    kind: SupervisorRunClientUpdate["gates"][number]["kind"];
    status: SupervisorRunClientUpdate["gates"][number]["status"];
    /** Bounded machine reason for the gate. */
    reason: string;
    createdAt: string;
    decidedAt?: string;
  }>;
  audit: {
    entries: Array<{
      auditId: string;
      kind: string;
      createdAt: string;
      actor: "user" | "orchestrator" | "worker" | "system";
      summary: string;
      taskId?: string;
      attemptId?: string;
    }>;
    total: number;
    truncated: boolean;
  };
  finalVerification: Array<{
    command: string;
    exitCode: number | null;
    outputSummary?: string;
    startedAt?: string;
    finishedAt?: string;
  }>;
  finalCommitSha?: string;
}

export interface SupervisorManagerInboxItem {
  runId: string;
  revision: number;
  projectId?: string;
  runStatus: SupervisorRunClientUpdate["status"];
  priority: SupervisorRunClientUpdate["priority"];
  decisionId: string;
  kind: string;
  status: "open" | "answered" | "cancelled";
  prompt: string;
  createdAt: string;
  answeredAt?: string;
}

export interface SupervisorManagerInboxRunUpdate {
  runId: string;
  revision: number;
  items: SupervisorManagerInboxItem[];
}

// ============================================================================
// useChat Hook Types
// ============================================================================

export interface UseChatOptions {
  chatId?: string | null;
  readOnly?: boolean;
  onFinish?: (payload: {
    stopReason: string;
    finishReason: string;
    messageId?: string;
    message?: UIMessage;
    isAbort: boolean;
    turnId?: string;
  }) => void;
  onError?: (message: string) => void;
}

export interface UseChatState {
  messages: UIMessage[];
  status: ChatStatus;
  connStatus: ConnectionStatus;
  pendingPermission: PermissionRequest | null;
  terminalOutputs: Record<string, string>;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  supportsModelSwitching: boolean;
  commands: AvailableCommand[];
  configOptions: SessionConfigOption[];
  sessionInfo: SessionInfo | null;
  supervisor: SupervisorSessionState | null;
  goalModeAudit: GoalModeAuditEntry[];
  supervisorCapable: boolean;
  subagents: SubagentInvocation[];
  promptCapabilities: PromptCapabilities | null;
  agentInfo: AgentInfo | null;
  loadSessionSupported: boolean | undefined;
  error: string | null;
}

export interface UseChatActions {
  sendMessage: (
    text: string,
    options?: {
      images?: { base64: string; mimeType: string }[];
      resources?: { uri: string; text: string; mimeType?: string }[];
      resourceLinks?: { uri: string; name: string; mimeType?: string }[];
    }
  ) => Promise<boolean>;
  cancelPrompt: () => Promise<void>;
  setMode: (modeId: string) => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<void>;
  respondToPermission: (requestId: string, decision: string) => Promise<void>;
  stopSession: () => Promise<void>;
  resumeSession: (chatId: string) => Promise<unknown>;
}

// ============================================================================
// Type Guards
// ============================================================================

export const isToolPart = (part: UIMessagePart): part is ToolUIPart =>
  part.type.startsWith("tool-");

export const isDataPart = (
  part: UIMessagePart,
  type: string
): part is DataUIPart => part.type === type;
