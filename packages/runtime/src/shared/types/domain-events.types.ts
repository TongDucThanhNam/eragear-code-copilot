import type { SupervisorRunClientUpdate } from "@eragear-code-copilot/shared";
import type { BroadcastEvent } from "./session.types";

export type DashboardRefreshReason =
  | "project_created"
  | "project_updated"
  | "project_deleted"
  | "project_set_active"
  | "agent_created"
  | "agent_updated"
  | "agent_deleted"
  | "session_stopped"
  | "session_deleted"
  | "settings_updated";

export interface DashboardRefreshEvent {
  type: "dashboard_refresh";
  reason: DashboardRefreshReason;
  userId?: string;
  projectId?: string;
  chatId?: string;
  agentId?: string;
}

export interface ProjectDeletingEvent {
  type: "project_deleting";
  userId: string;
  projectId: string;
  projectPath: string;
}

export interface ProjectDeletedEvent {
  type: "project_deleted";
  userId: string;
  projectId: string;
  projectPath: string;
}

export interface SettingsUpdatedEvent {
  type: "settings_updated";
  changedKeys: string[];
  requiresRestart: string[];
}

export interface SessionBroadcastEvent {
  type: "session_broadcast";
  userId: string;
  chatId: string;
  event: BroadcastEvent;
}

export type PromptSource =
  | "client"
  | "supervisor"
  | "automation"
  | "scheduled"
  | "orchestrator";

export interface AgentSessionCreatedEvent {
  type: "agent_session_created";
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId: string;
  agentSessionId?: string;
}

export interface PromptMessageSentEvent {
  type: "prompt_message_sent";
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId: string;
  agentSessionId?: string;
  turnId: string;
  source: PromptSource;
}

export interface PromptTurnStartedEvent {
  type: "prompt_turn_started";
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId: string;
  agentSessionId?: string;
  turnId: string;
  source: PromptSource;
}

export interface PromptTurnCompletedEvent {
  type: "prompt_turn_completed";
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId: string;
  agentSessionId?: string;
  turnId: string;
  stopReason: string;
  source: PromptSource;
}

export interface SupervisorTurnTerminalEvent {
  type: "supervisor_turn_terminal";
  userId: string;
  chatId: string;
  turnId?: string;
  source: "client" | "supervisor" | "orchestrator";
  action: "done" | "needs_user" | "abort";
  reason: string;
  /** Bounded latest assistant text only; never a transcript or raw diff. */
  resultText: string;
}

export interface SupervisorRunUpdatedEvent {
  type: "supervisor_run_updated";
  userId: string;
  projectId?: string;
  update: SupervisorRunClientUpdate;
}

export interface SupervisorCapacitySuspendedEvent {
  type: "supervisor_capacity_suspended";
  userId: string;
  runId: string;
  projectId?: string;
  owner: "manager" | "task";
  taskId?: string;
  attemptId?: string;
  agentId: string;
  capacityGroup?: string;
  kind:
    | "quota_exhausted"
    | "transient_rate_limit"
    | "auth_required"
    | "transport"
    | "session_fatal"
    | "unknown";
  retryAt: string;
  resetAt?: string;
}

export interface SupervisorCapacityResumedEvent {
  type: "supervisor_capacity_resumed";
  userId: string;
  runId: string;
  projectId?: string;
  waitId: string;
  owner: "manager" | "task";
  taskId?: string;
  attemptId?: string;
  agentId: string;
  resumedAt: string;
}

export interface ManagerInboxUpdatedEvent {
  type: "manager_inbox_updated";
  userId: string;
  runId: string;
  projectId?: string;
  decisionId: string;
  status: "open" | "answered" | "cancelled";
  kind: string;
  updatedAt: string;
}

export interface AgentSessionStoppedEvent {
  type: "agent_session_stopped";
  userId: string;
  projectRoot: string;
  projectId?: string;
  chatId: string;
  agentSessionId?: string;
  stopReason?: string;
}

export interface SubagentInvocationRequestedEvent {
  type: "subagent_invocation_requested";
  userId: string;
  chatId: string;
  projectRoot: string;
  projectId?: string;
  agentSessionId?: string;
  turnId: string;
  subagent: {
    name: string;
    description?: string;
    sourcePath: string;
  };
}

export type ProviderQuotaEventStatus =
  | "ready"
  | "not_configured"
  | "unavailable"
  | "error";

export interface ProviderQuotaEventWindow {
  id: string;
  windowType?: string;
  label: string;
  percentRemaining?: number;
  used?: number;
  total?: number;
  remaining?: number;
  unlimited?: boolean;
  startedAt?: string;
  resetAt?: string;
  durationMs?: number;
  scope?: string;
}

export interface ProviderQuotaRefreshedEvent {
  type: "provider_quota_refreshed";
  userId: string;
  providerId: string;
  providerDisplayName: string;
  status: ProviderQuotaEventStatus;
  previousStatus?: ProviderQuotaEventStatus;
  fetchedAt: string;
  windows: ProviderQuotaEventWindow[];
  minPercentRemaining?: number;
  nextResetAt?: string;
  changed: boolean;
}

export interface CodingPlanSubscriptionUpdatedEvent {
  type: "coding_plan_subscription_updated";
  userId: string;
  tier: "free" | "pro" | "team" | "enterprise";
  previousTier?: "free" | "pro" | "team" | "enterprise";
  status: "none" | "trialing" | "active" | "past_due" | "canceled" | "expired";
  previousStatus?:
    | "none"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "expired";
  source: "local" | "billing_sync";
  updatedAt: string;
  changed: boolean;
}

export interface ScheduledTaskUpdatedEvent {
  type: "scheduled_task_updated";
  userId: string;
  botId: string;
  runId?: string;
  kind: "definition" | "run" | "deleted";
  status?: string;
  updatedAt: number;
}

export interface FileWatcherFileChangedEvent {
  type: "file_watcher_file_changed";
  projectRoot: string;
  path: string;
  eventKind: "changed" | "renamed";
  occurredAt: string;
  sessions: Array<{
    userId: string;
    chatId: string;
    projectId?: string;
  }>;
}

export type DomainEvent =
  | DashboardRefreshEvent
  | ProjectDeletingEvent
  | ProjectDeletedEvent
  | SettingsUpdatedEvent
  | SessionBroadcastEvent
  | AgentSessionCreatedEvent
  | PromptMessageSentEvent
  | PromptTurnStartedEvent
  | PromptTurnCompletedEvent
  | SupervisorTurnTerminalEvent
  | SupervisorRunUpdatedEvent
  | SupervisorCapacitySuspendedEvent
  | SupervisorCapacityResumedEvent
  | ManagerInboxUpdatedEvent
  | AgentSessionStoppedEvent
  | SubagentInvocationRequestedEvent
  | ProviderQuotaRefreshedEvent
  | CodingPlanSubscriptionUpdatedEvent
  | ScheduledTaskUpdatedEvent
  | FileWatcherFileChangedEvent;
