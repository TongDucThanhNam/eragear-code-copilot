import type { AcpAuthService } from "#runtime/modules/acp-auth";
import type {
  CreateAgentService,
  DeleteAgentService,
  EnsureAgentDefaultsService,
  ListAgentsService,
  SetActiveAgentService,
  UpdateAgentService,
} from "#runtime/modules/agent";
import type {
  CancelPromptService,
  SendMessageService,
  SetConfigOptionService,
  SetModelService,
  SetModeService,
} from "#runtime/modules/ai";
import type { GetMeService } from "#runtime/modules/auth";
import type { BotsService } from "#runtime/modules/bots";
import type { CodingPlanSubscriptionService } from "#runtime/modules/coding-plan-subscription";
import type { SlashCommandsService } from "#runtime/modules/commands";
import type { ContextUsageService } from "#runtime/modules/context-usage";
import type { CrashReportingService } from "#runtime/modules/crash-reporting";
import type { CredentialService } from "#runtime/modules/credential";
import type { FeedbackService } from "#runtime/modules/feedback";
import type { FileWatcherPort } from "#runtime/modules/file-watcher";
import type { GitCheckpointService, GitService } from "#runtime/modules/git";
import type { HooksService } from "#runtime/modules/hooks";
import type { MemoryService } from "#runtime/modules/memory";
import type { ModelProviderService } from "#runtime/modules/model-provider";
import type { OAuthService } from "#runtime/modules/oauth";
import type {
  DashboardEventVisibilityService,
  GetDashboardPageDataService,
  GetDashboardStatsService,
  GetObservabilitySnapshotService,
  ListDashboardProjectsService,
  ListDashboardSessionsService,
} from "#runtime/modules/ops";
import type { OutputStyleService } from "#runtime/modules/output-style";
import type { PluginsService } from "#runtime/modules/plugins";
import type {
  CreateProjectService,
  DeleteProjectService,
  ListProjectsService,
  SetActiveProjectService,
  UpdateProjectService,
} from "#runtime/modules/project";
import type { PromptEnhancementService } from "#runtime/modules/prompt-enhancement";
import type { ProviderQuotaService } from "#runtime/modules/quota";
import type { RemoteControlService } from "#runtime/modules/remote-control";
import type { RepoSnapshotIndexingService } from "#runtime/modules/repo-snapshot-indexing";
import type {
  CleanupProjectSessionsService,
  CreateSessionService,
  DeleteSessionService,
  DiscoverAgentSessionsService,
  ForkSessionService,
  ListSessionForksService,
  LoadAgentSessionService,
  ReconcileSessionStatusService,
  ResumeSessionService,
  SessionQueries,
  StopSessionService,
  SubagentService,
  SubscribeSessionEventsService,
  UpdateSessionMetaService,
} from "#runtime/modules/session";
import type {
  GetSettingsService,
  LocalAdeService,
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "#runtime/modules/settings";
import type { SettingsSyncService } from "#runtime/modules/settings-sync";
import type { SkillsService } from "#runtime/modules/skills";
import type {
  SetSupervisorModeService,
  SupervisorLoopService,
  SupervisorPermissionService,
} from "#runtime/modules/supervisor";
import type { TaskAutoArchiveService } from "#runtime/modules/task-auto-archive";
import type { TerminalService } from "#runtime/modules/terminal";
import type {
  CodeContextService,
  RespondPermissionService,
} from "#runtime/modules/tooling";
import type { TrafficProxyService } from "#runtime/modules/traffic-proxy";
import type { UsageStatsService } from "#runtime/modules/usage-stats";

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
  fork: UseCasePort<ForkSessionService>;
  forkBindings: UseCasePort<ListSessionForksService>;
  delete: UseCasePort<DeleteSessionService>;
  queries: UseCasePort<SessionQueries>;
  updateMeta: UseCasePort<UpdateSessionMetaService>;
  events: UseCasePort<SubscribeSessionEventsService>;
  cleanupProjectSessions: UseCasePort<CleanupProjectSessionsService>;
  reconcileStatus: UseCasePort<ReconcileSessionStatusService>;
  subagents: UseCasePort<SubagentService>;
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
 * Git integration use-cases for repository status and changed-file views.
 *
 * Caller contract: reads are project-scoped and tenant-owned; transports must
 * not pass arbitrary paths directly to the adapter.
 */
export interface GitUseCases {
  repository: UseCasePort<GitService>;
  checkpoints: UseCasePort<GitCheckpointService>;
}

/**
 * Provider quota use-cases.
 *
 * Caller contract: `list` may use cache, while `refresh` forces provider IO and
 * reports provider quota refresh notifications for queue/scheduler triggers.
 */
export interface QuotaUseCases {
  provider: UseCasePort<ProviderQuotaService>;
}

/**
 * Supervisor use-cases for completed-turn review, permission auto-resolution,
 * and persisted autopilot mode.
 */
export interface SupervisorUseCases {
  loop: UseCasePort<SupervisorLoopService>;
  setMode: UseCasePort<SetSupervisorModeService>;
  permission: UseCasePort<SupervisorPermissionService>;
}

/**
 * Skills use-cases backed by local capability discovery.
 */
export interface SkillsUseCases {
  skills: UseCasePort<SkillsService>;
}

/**
 * Slash command registry use-cases for discovered and custom prompt commands.
 */
export interface CommandsUseCases {
  commands: UseCasePort<SlashCommandsService>;
}

/**
 * Hook automation use-cases backed by local ADE hook execution.
 */
export interface HooksUseCases {
  hooks: UseCasePort<HooksService>;
}

/**
 * Project memory use-cases for source toggles, presets, and prompt context.
 */
export interface MemoryUseCases {
  memory: UseCasePort<MemoryService>;
}

/**
 * File watcher use-cases for live project file tree refreshes.
 */
export interface FileWatcherUseCases {
  fileWatcher: UseCasePort<FileWatcherPort>;
}

/**
 * Context usage use-cases for per-task token and context-window estimates.
 */
export interface ContextUsageUseCases {
  contextUsage: UseCasePort<ContextUsageService>;
}

/**
 * Credential use-cases for encrypted provider/API secret management.
 */
export interface CredentialUseCases {
  credential: UseCasePort<CredentialService>;
}

/**
 * Model provider registry use-cases for provider CRUD, mappings, and model
 * format support.
 */
export interface ModelProviderUseCases {
  modelProvider: UseCasePort<ModelProviderService>;
}

/**
 * ACP provider auth use-cases for provider-scoped auth files and startup sync.
 *
 * Invariant: raw secrets stay in the credential module until sync materializes
 * provider auth files under the configured private storage directory.
 */
export interface AcpAuthUseCases {
  acpAuth: UseCasePort<AcpAuthService>;
}

/**
 * Prompt enhancement use-cases for stored prompt preprocessing settings and
 * server-side prompt enrichment.
 */
export interface PromptEnhancementUseCases {
  promptEnhancement: UseCasePort<PromptEnhancementService>;
}

/**
 * Interactive terminal use-cases for runtime terminal panels.
 */
export interface TerminalUseCases {
  terminal: UseCasePort<TerminalService>;
}

/**
 * OAuth provider use-cases for configured provider metadata, linked accounts,
 * and cached provider session restore signals.
 */
export interface OAuthUseCases {
  oauth: UseCasePort<OAuthService>;
}

/**
 * Settings sync use-cases for cloud snapshot state, conflict resolution, and
 * first-run prompt state.
 */
export interface SettingsSyncUseCases {
  settingsSync: UseCasePort<SettingsSyncService>;
}

/**
 * Response feedback use-cases for thumbs up/down persistence and review lists.
 */
export interface FeedbackUseCases {
  feedback: UseCasePort<FeedbackService>;
}

/**
 * Output style use-cases for persisted response style defaults.
 */
export interface OutputStyleUseCases {
  outputStyle: UseCasePort<OutputStyleService>;
}

/**
 * Coding plan subscription use-cases for entitlement and billing hook state.
 */
export interface CodingPlanSubscriptionUseCases {
  codingPlanSubscription: UseCasePort<CodingPlanSubscriptionService>;
}

/**
 * Usage statistics use-cases for local analytics and telemetry opt-in state.
 */
export interface UsageStatsUseCases {
  usageStats: UseCasePort<UsageStatsService>;
}

/**
 * Plugin use-cases for SDK metadata, lifecycle state, and marketplace hooks.
 */
export interface PluginsUseCases {
  plugins: UseCasePort<PluginsService>;
}

/**
 * Repo snapshot indexing use-cases for codebase index refresh, manifest
 * history, and search/retrieval.
 */
export interface RepoSnapshotIndexingUseCases {
  repoSnapshotIndexing: UseCasePort<RepoSnapshotIndexingService>;
}

/**
 * Task auto-archive use-cases for threshold policy and background archival.
 */
export interface TaskAutoArchiveUseCases {
  taskAutoArchive: UseCasePort<TaskAutoArchiveService>;
}

/**
 * Web remote-control use-cases for external relay device registration and
 * user-scoped remote session lifecycle.
 */
export interface RemoteControlUseCases {
  remoteControl: UseCasePort<RemoteControlService>;
}

/**
 * Bot definition and run lifecycle use-cases for trigger-driven task
 * orchestration.
 */
export interface BotsUseCases {
  bots: UseCasePort<BotsService>;
}

/**
 * ACP traffic proxy use-cases for persisted proxy and CA configuration that is
 * injected into spawned agent processes.
 */
export interface TrafficProxyUseCases {
  trafficProxy: UseCasePort<TrafficProxyService>;
}

/**
 * Crash reporting use-cases for local archive and optional Sentry delivery.
 */
export interface CrashReportingUseCases {
  crashReporting: UseCasePort<CrashReportingService>;
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
  git: GitUseCases;
  quota: QuotaUseCases;
  supervisor: SupervisorUseCases;
  commands: CommandsUseCases;
  skills: SkillsUseCases;
  hooks: HooksUseCases;
  memory: MemoryUseCases;
  fileWatcher: FileWatcherUseCases;
  contextUsage: ContextUsageUseCases;
  credential: CredentialUseCases;
  modelProvider: ModelProviderUseCases;
  acpAuth: AcpAuthUseCases;
  promptEnhancement: PromptEnhancementUseCases;
  terminal: TerminalUseCases;
  oauth: OAuthUseCases;
  settingsSync: SettingsSyncUseCases;
  feedback: FeedbackUseCases;
  outputStyle: OutputStyleUseCases;
  codingPlanSubscription: CodingPlanSubscriptionUseCases;
  usageStats: UsageStatsUseCases;
  plugins: PluginsUseCases;
  repoSnapshotIndexing: RepoSnapshotIndexingUseCases;
  taskAutoArchive: TaskAutoArchiveUseCases;
  remoteControl: RemoteControlUseCases;
  bots: BotsUseCases;
  trafficProxy: TrafficProxyUseCases;
  crashReporting: CrashReportingUseCases;
}
