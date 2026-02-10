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

export type DomainEvent =
  | DashboardRefreshEvent
  | ProjectDeletingEvent
  | ProjectDeletedEvent
  | SettingsUpdatedEvent
  | SessionBroadcastEvent;
