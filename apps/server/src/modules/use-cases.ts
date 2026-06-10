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
  CreateSessionService,
  DeleteSessionService,
  DiscoverAgentSessionsService,
  LoadAgentSessionService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  SessionQueries,
  StopSessionService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "@/modules/session";
import type {
  GetSettingsService,
  LocalAdeService,
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "@/modules/settings";
import type { SetSupervisorModeService } from "@/modules/supervisor";
import type {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";

type UseCaseMethodKeys<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

/**
 * Transport-facing view of a use-case object.
 *
 * Invariant: only callable methods are exposed, so routers cannot depend on
 * constructor details, private state, repositories, or concrete adapter fields.
 */
export type UseCasePort<T> = Pick<T, UseCaseMethodKeys<T>>;

/**
 * Session use-cases built once by composition and shared by transports.
 *
 * Caller contract: read/maintenance operations go through `queries`; mutating
 * lifecycle operations remain explicit so their side effects are visible.
 */
export interface SessionUseCases {
  create: UseCasePort<CreateSessionService>;
  discoverAgentSessions: UseCasePort<DiscoverAgentSessionsService>;
  loadAgentSession: UseCasePort<LoadAgentSessionService>;
  stop: UseCasePort<StopSessionService>;
  resume: UseCasePort<ResumeSessionService>;
  delete: UseCasePort<DeleteSessionService>;
  queries: UseCasePort<SessionQueries>;
  updateMeta: UseCasePort<UpdateSessionMetaService>;
  events: UseCasePort<SubscribeSessionEventsService>;
  cleanupProjectSessions: UseCasePort<CleanupProjectSessionsService>;
  reconcileStatus: UseCasePort<ReconcileSessionStatusService>;
}

/**
 * AI use-cases for prompt traffic and runtime agent configuration.
 *
 * Ordering requirement: prompt submission and config changes are responsible
 * for acquiring session runtime locks before mutating live session state.
 */
export interface AiUseCases {
  sendMessage: UseCasePort<SendMessageService>;
  setModel: UseCasePort<SetModelService>;
  setMode: UseCasePort<SetModeService>;
  setConfigOption: UseCasePort<SetConfigOptionService>;
  cancelPrompt: UseCasePort<CancelPromptService>;
  setSupervisorMode: UseCasePort<SetSupervisorModeService>;
}

/**
 * Project use-cases scoped to the authenticated user.
 *
 * Side effect: lifecycle mutations may publish dashboard/session cleanup events
 * through the event bus after repository state changes.
 */
export interface ProjectUseCases {
  list: UseCasePort<ListProjectsService>;
  create: UseCasePort<CreateProjectService>;
  update: UseCasePort<UpdateProjectService>;
  delete: UseCasePort<DeleteProjectService>;
  setActive: UseCasePort<SetActiveProjectService>;
}

/**
 * Agent configuration use-cases scoped to the authenticated user.
 *
 * Invariant: create/delete operations maintain an active-agent selection so UI
 * callers never have to repair a dangling active id.
 */
export interface AgentUseCases {
  ensureDefaults: UseCasePort<EnsureAgentDefaultsService>;
  list: UseCasePort<ListAgentsService>;
  create: UseCasePort<CreateAgentService>;
  update: UseCasePort<UpdateAgentService>;
  delete: UseCasePort<DeleteAgentService>;
  setActive: UseCasePort<SetActiveAgentService>;
}

/**
 * Settings use-cases for persisted settings and boot allowlist management.
 *
 * Caller contract: settings updates may take effect live through
 * `AppConfigService`, while boot allowlist updates can require process restart.
 */
export interface SettingsUseCases {
  get: UseCasePort<GetSettingsService>;
  update: UseCasePort<UpdateSettingsService>;
  manageBootAllowlists: UseCasePort<ManageBootAllowlistsService>;
  localAde: UseCasePort<LocalAdeService>;
}

/**
 * Tooling use-cases that bridge UI decisions to runtime/tool adapters.
 *
 * Error mode: callers should expect typed not-found/validation errors when a
 * permission request was already settled or belongs to another user.
 */
export interface ToolingUseCases {
  codeContext: UseCasePort<CodeContextService>;
  respondPermission: UseCasePort<RespondPermissionService>;
}

/**
 * Auth read use-cases exposed to transport.
 *
 * Invariant: authentication is established by transport before these use-cases
 * are called; this surface only normalizes user profile data for clients.
 */
export interface AuthUseCases {
  getMe: UseCasePort<GetMeService>;
}

/**
 * Operational read use-cases for dashboard and observability views.
 *
 * Caller contract: every read must be scoped to the authenticated user before
 * returning session, log, or runtime state.
 */
export interface OpsUseCases {
  dashboardEventVisibility: UseCasePort<DashboardEventVisibilityService>;
  observabilitySnapshot: UseCasePort<GetObservabilitySnapshotService>;
  dashboardProjects: UseCasePort<ListDashboardProjectsService>;
  dashboardSessions: UseCasePort<ListDashboardSessionsService>;
  dashboardStats: UseCasePort<GetDashboardStatsService>;
  dashboardPageData: UseCasePort<GetDashboardPageDataService>;
}

/**
 * Complete application use-case graph built by the composition root.
 *
 * Invariant: this object is constructed once per server instance and passed to
 * transport contexts; routers must not instantiate services directly.
 */
export interface AppUseCases {
  session: SessionUseCases;
  ai: AiUseCases;
  project: ProjectUseCases;
  agent: AgentUseCases;
  settings: SettingsUseCases;
  tooling: ToolingUseCases;
  auth: AuthUseCases;
  ops: OpsUseCases;
}
