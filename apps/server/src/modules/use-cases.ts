import type { AcpAuthService } from "@/modules/acp-auth";
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
import type { BotsService } from "@/modules/bots";
import type { CodingPlanSubscriptionService } from "@/modules/coding-plan-subscription";
import type { SlashCommandsService } from "@/modules/commands";
import type { ContextUsageService } from "@/modules/context-usage";
import type { CrashReportingService } from "@/modules/crash-reporting";
import type { CredentialService } from "@/modules/credential";
import type { FeedbackService } from "@/modules/feedback";
import type { FileWatcherService } from "@/modules/file-watcher";
import type { GitCheckpointService, GitService } from "@/modules/git";
import type { HooksService } from "@/modules/hooks";
import type { MemoryService } from "@/modules/memory";
import type { ModelProviderService } from "@/modules/model-provider";
import type { OAuthService } from "@/modules/oauth";
import type {
  DashboardEventVisibilityService,
  GetDashboardPageDataService,
  GetDashboardStatsService,
  GetObservabilitySnapshotService,
  ListDashboardProjectsService,
  ListDashboardSessionsService,
} from "@/modules/ops";
import type { OutputStyleService } from "@/modules/output-style";
import type { PluginsService } from "@/modules/plugins";
import type {
  CreateProjectService,
  DeleteProjectService,
  ListProjectsService,
  SetActiveProjectService,
  UpdateProjectService,
} from "@/modules/project";
import type { PromptEnhancementService } from "@/modules/prompt-enhancement";
import type { ProviderQuotaService } from "@/modules/quota";
import type { RemoteControlService } from "@/modules/remote-control";
import type { RepoSnapshotIndexingService } from "@/modules/repo-snapshot-indexing";
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
} from "@/modules/session";
import type {
  GetSettingsService,
  LocalAdeService,
  ManageBootAllowlistsService,
  UpdateSettingsService,
} from "@/modules/settings";
import type { SettingsSyncService } from "@/modules/settings-sync";
import type { SkillsService } from "@/modules/skills";
import type { SetSupervisorModeService } from "@/modules/supervisor";
import type { TaskAutoArchiveService } from "@/modules/task-auto-archive";
import type { TerminalService } from "@/modules/terminal";
import type {
  CodeContextService,
  RespondPermissionService,
} from "@/modules/tooling";
import type { TrafficProxyService } from "@/modules/traffic-proxy";
import type { UsageStatsService } from "@/modules/usage-stats";

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
 * emits `provider_quota_refreshed` events for queue/scheduler triggers.
 */
export interface QuotaUseCases {
  provider: UseCasePort<ProviderQuotaService>;
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
  fileWatcher: UseCasePort<FileWatcherService>;
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
