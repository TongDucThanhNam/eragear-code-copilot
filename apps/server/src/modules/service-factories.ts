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
  SetConfigOptionService,
  SetModelService,
  SetModeService,
} from "@/modules/ai";
import type { GetMeService } from "@/modules/auth";
import type {
  DashboardEventVisibilityService,
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
  GetSessionMessageByIdService,
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
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "@/modules/settings";
import type {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";

type ServiceMethodKeys<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

type ServicePort<T> = Pick<T, ServiceMethodKeys<T>>;

export interface SessionServiceFactory {
  createSession(): ServicePort<CreateSessionService>;
  stopSession(): ServicePort<StopSessionService>;
  resumeSession(): ServicePort<ResumeSessionService>;
  deleteSession(): ServicePort<DeleteSessionService>;
  getSessionState(): ServicePort<GetSessionStateService>;
  listSessions(): ServicePort<ListSessionsService>;
  updateSessionMeta(): ServicePort<UpdateSessionMetaService>;
  getSessionMessagesPage(): ServicePort<GetSessionMessagesService>;
  getSessionMessageById(): ServicePort<GetSessionMessageByIdService>;
  getSessionStorageStats(): ServicePort<GetSessionStorageStatsService>;
  subscribeSessionEvents(): ServicePort<SubscribeSessionEventsService>;
  cleanupProjectSessions(): ServicePort<CleanupProjectSessionsService>;
  reconcileSessionStatus(): ServicePort<ReconcileSessionStatusService>;
  compactSessionMessages(): ServicePort<CompactSessionMessagesService>;
}

export interface AiServiceFactory {
  sendMessage(): ServicePort<SendMessageService>;
  setModel(): ServicePort<SetModelService>;
  setMode(): ServicePort<SetModeService>;
  setConfigOption(): ServicePort<SetConfigOptionService>;
  cancelPrompt(): ServicePort<CancelPromptService>;
}

export interface ProjectServiceFactory {
  listProjects(): ServicePort<ListProjectsService>;
  createProject(): ServicePort<CreateProjectService>;
  updateProject(): ServicePort<UpdateProjectService>;
  deleteProject(): ServicePort<DeleteProjectService>;
  setActiveProject(): ServicePort<SetActiveProjectService>;
}

export interface AgentServiceFactory {
  ensureAgentDefaults(): ServicePort<EnsureAgentDefaultsService>;
  listAgents(): ServicePort<ListAgentsService>;
  createAgent(): ServicePort<CreateAgentService>;
  updateAgent(): ServicePort<UpdateAgentService>;
  deleteAgent(): ServicePort<DeleteAgentService>;
  setActiveAgent(): ServicePort<SetActiveAgentService>;
}

export interface SettingsServiceFactory {
  getSettings(): ServicePort<GetSettingsService>;
  updateSettings(): ServicePort<UpdateSettingsService>;
  manageBootAllowlists(): ServicePort<ManageBootAllowlistsService>;
}

export interface ToolingServiceFactory {
  codeContext(): ServicePort<CodeContextService>;
  respondPermission(): ServicePort<RespondPermissionService>;
}

export interface AuthServiceFactory {
  getMe(): ServicePort<GetMeService>;
}

export interface OpsServiceFactory {
  dashboardEventVisibility(): ServicePort<DashboardEventVisibilityService>;
  observabilitySnapshot(): ServicePort<GetObservabilitySnapshotService>;
  dashboardProjects(): ServicePort<ListDashboardProjectsService>;
  dashboardSessions(): ServicePort<ListDashboardSessionsService>;
  dashboardStats(): ServicePort<GetDashboardStatsService>;
  dashboardPageData(): ServicePort<GetDashboardPageDataService>;
}
