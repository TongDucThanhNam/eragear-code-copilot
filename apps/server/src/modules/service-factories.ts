import type {
  CreateAgentService,
  DeleteAgentService,
  EnsureAgentDefaultsService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "@/modules/agent";
import type {
  CancelPromptService,
  SendMessageService,
  SetModelService,
  SetModeService,
} from "@/modules/ai";
import type {
  GetDashboardPageDataService,
  GetDashboardStatsService,
  GetObservabilitySnapshotService,
  ListDashboardProjectsService,
  ListDashboardSessionsService,
} from "@/modules/ops";
import type {
  CreateProjectService,
  DeleteProjectService,
  ListProjectsService,
  SetActiveProjectService,
  UpdateProjectService,
} from "@/modules/project";
import type {
  CleanupProjectSessionsService,
  CompactSessionMessagesService,
  CreateSessionService,
  DeleteSessionService,
  GetSessionMessagesService,
  GetSessionStateService,
  GetSessionStorageStatsService,
  ListSessionsService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  StopSessionService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "@/modules/session";
import type {
  GetSettingsService,
  UpdateSettingsService,
} from "@/modules/settings";
import type {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";

export interface SessionServiceFactory {
  createSession(): CreateSessionService;
  stopSession(): StopSessionService;
  resumeSession(): ResumeSessionService;
  deleteSession(): DeleteSessionService;
  getSessionState(): GetSessionStateService;
  listSessions(): ListSessionsService;
  updateSessionMeta(): UpdateSessionMetaService;
  getSessionMessages(): GetSessionMessagesService;
  getSessionStorageStats(): GetSessionStorageStatsService;
  subscribeSessionEvents(): SubscribeSessionEventsService;
  cleanupProjectSessions(): CleanupProjectSessionsService;
  reconcileSessionStatus(): ReconcileSessionStatusService;
  compactSessionMessages(): CompactSessionMessagesService;
}

export interface AiServiceFactory {
  sendMessage(): SendMessageService;
  setModel(): SetModelService;
  setMode(): SetModeService;
  cancelPrompt(): CancelPromptService;
}

export interface ProjectServiceFactory {
  listProjects(): ListProjectsService;
  createProject(): CreateProjectService;
  updateProject(): UpdateProjectService;
  deleteProject(): DeleteProjectService;
  setActiveProject(): SetActiveProjectService;
}

export interface AgentServiceFactory {
  ensureAgentDefaults(): EnsureAgentDefaultsService;
  listAgents(): ListAgentsService;
  createAgent(): CreateAgentService;
  updateAgent(): UpdateAgentService;
  deleteAgent(): DeleteAgentService;
  setActiveAgent(): SetActiveAgentService;
}

export interface SettingsServiceFactory {
  getSettings(): GetSettingsService;
  updateSettings(): UpdateSettingsService;
}

export interface ToolingServiceFactory {
  codeContext(): CodeContextService;
  respondPermission(): RespondPermissionService;
}

export interface OpsServiceFactory {
  observabilitySnapshot(): GetObservabilitySnapshotService;
  dashboardProjects(): ListDashboardProjectsService;
  dashboardSessions(): ListDashboardSessionsService;
  dashboardStats(): GetDashboardStatsService;
  dashboardPageData(): GetDashboardPageDataService;
}
