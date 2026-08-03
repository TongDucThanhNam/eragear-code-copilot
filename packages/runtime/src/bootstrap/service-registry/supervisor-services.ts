import {
  LocalAdeRepoSnapshotIndexAdapter,
  type LocalAdeRepoSnapshotIndexSource,
} from "#runtime/modules/repo-snapshot-indexing/di";
import { ScopeImportGraphService } from "#runtime/modules/scope-resolution";
import {
  createEventBusSupervisorTerminalNotifier,
  ScheduledWorkDecisionService,
  SetSupervisorModeService,
  type SupervisorAuditPort,
  SupervisorChatService,
  SupervisorLoopService,
  type SupervisorMemoryContext,
  type SupervisorMemoryLogInput,
  type SupervisorMemoryLookupInput,
  type SupervisorMemoryPort,
  SupervisorPermissionService,
  type SupervisorPolicy,
  type SupervisorProjectIntelligencePort,
  type SupervisorResearchPort,
  type SupervisorResearchResult,
} from "#runtime/modules/supervisor";
import {
  AiSdkScheduledWorkDecisionAdapter,
  AiSdkSupervisorChatAdapter,
  AiSdkSupervisorDecisionAdapter,
  ExaSupervisorResearchAdapter,
  FileSystemSupervisorProjectContextAdapter,
  NoopSupervisorAuditAdapter,
  NoopSupervisorMemoryAdapter,
  NoopSupervisorResearchAdapter,
  ObsidianSupervisorMemoryAdapter,
  ScopeSupervisorProjectIntelligenceAdapter,
} from "#runtime/modules/supervisor/di";
import type {
  AiUseCases,
  ScopeResolutionUseCases,
  SupervisorUseCases,
} from "#runtime/modules/use-cases";
import type { LoggerPort } from "#runtime/shared/ports/logger.port";
import type { ServiceRegistrySlice } from "./dependencies";

type SupervisorServiceDependencies = ServiceRegistrySlice<
  | "supervisorPolicy"
  | "appLogger"
  | "sessionRepo"
  | "sessionRuntime"
  | "projectRepo"
  | "clock"
  | "eventBus"
>;

class SettingsBackedSupervisorResearchAdapter
  implements SupervisorResearchPort
{
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;

  constructor(policy: SupervisorPolicy, logger: LoggerPort) {
    this.policy = policy;
    this.logger = logger;
  }

  search(query: string): Promise<SupervisorResearchResult[]> {
    if (
      this.policy.webSearchProvider === "exa" &&
      this.policy.webSearchApiKey
    ) {
      return new ExaSupervisorResearchAdapter(
        this.policy.webSearchApiKey,
        this.logger
      ).search(query);
    }
    return new NoopSupervisorResearchAdapter().search();
  }
}

class SettingsBackedSupervisorMemoryAdapter implements SupervisorMemoryPort {
  private readonly policy: SupervisorPolicy;
  private readonly logger: LoggerPort;

  constructor(policy: SupervisorPolicy, logger: LoggerPort) {
    this.policy = policy;
    this.logger = logger;
  }

  lookup(input: SupervisorMemoryLookupInput): Promise<SupervisorMemoryContext> {
    return this.resolveAdapter().lookup(input);
  }

  appendLog(input: SupervisorMemoryLogInput): Promise<void> {
    return this.resolveAdapter().appendLog(input);
  }

  private resolveAdapter(): SupervisorMemoryPort {
    if (this.policy.memoryProvider !== "obsidian") {
      return new NoopSupervisorMemoryAdapter();
    }
    return new ObsidianSupervisorMemoryAdapter(
      {
        command: this.policy.obsidianCommand,
        ...(this.policy.obsidianVault
          ? { vault: this.policy.obsidianVault }
          : {}),
        ...(this.policy.obsidianBlueprintPath
          ? { blueprintPath: this.policy.obsidianBlueprintPath }
          : {}),
        ...(this.policy.obsidianLogPath
          ? { logPath: this.policy.obsidianLogPath }
          : {}),
        searchPath: this.policy.obsidianSearchPath,
        searchLimit: this.policy.obsidianSearchLimit,
        timeoutMs: this.policy.obsidianTimeoutMs,
      },
      this.logger
    );
  }
}

export function createSupervisorUseCases(
  deps: SupervisorServiceDependencies,
  aiUseCases: Pick<AiUseCases, "sendMessage">,
  options: {
    projectIntelligence?: SupervisorProjectIntelligencePort;
  } = {}
): SupervisorUseCases {
  const supervisorDecisionAdapter = new AiSdkSupervisorDecisionAdapter(
    deps.supervisorPolicy,
    deps.appLogger
  );
  const supervisorChatAdapter = new AiSdkSupervisorChatAdapter(
    deps.supervisorPolicy,
    deps.appLogger
  );
  const supervisorProjectContextAdapter =
    new FileSystemSupervisorProjectContextAdapter();
  const supervisorResearchAdapter: SupervisorResearchPort =
    new SettingsBackedSupervisorResearchAdapter(
      deps.supervisorPolicy,
      deps.appLogger
    );
  const supervisorMemoryAdapter: SupervisorMemoryPort =
    new SettingsBackedSupervisorMemoryAdapter(
      deps.supervisorPolicy,
      deps.appLogger
    );
  const supervisorAuditAdapter: SupervisorAuditPort =
    new NoopSupervisorAuditAdapter();
  const setSupervisorMode = new SetSupervisorModeService({
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    policy: deps.supervisorPolicy,
    clock: deps.clock,
  });

  return {
    loop: new SupervisorLoopService({
      sessionRepo: deps.sessionRepo,
      sessionRuntime: deps.sessionRuntime,
      projectRepo: deps.projectRepo,
      sendMessage: aiUseCases.sendMessage,
      decisionPort: supervisorDecisionAdapter,
      researchPort: supervisorResearchAdapter,
      memoryPort: supervisorMemoryAdapter,
      auditPort: supervisorAuditAdapter,
      policy: deps.supervisorPolicy,
      logger: deps.appLogger,
      clock: deps.clock,
      terminalNotifier: createEventBusSupervisorTerminalNotifier({
        eventBus: deps.eventBus,
        logger: deps.appLogger,
      }),
    }),
    setMode: setSupervisorMode,
    permission: new SupervisorPermissionService({
      sessionRuntime: deps.sessionRuntime,
      sessionRepo: deps.sessionRepo,
      decisionPort: supervisorDecisionAdapter,
      memoryPort: supervisorMemoryAdapter,
      policy: deps.supervisorPolicy,
      logger: deps.appLogger,
      clock: deps.clock,
    }),
    chat: new SupervisorChatService({
      sessionRepo: deps.sessionRepo,
      sessionRuntime: deps.sessionRuntime,
      chatPort: supervisorChatAdapter,
      projectContext: supervisorProjectContextAdapter,
      projectIntelligence: options.projectIntelligence,
      clock: deps.clock,
    }),
    scheduledWork: new ScheduledWorkDecisionService({
      decision: new AiSdkScheduledWorkDecisionAdapter(
        deps.supervisorPolicy,
        deps.appLogger
      ),
      projectContext: supervisorProjectContextAdapter,
      projectIntelligence: options.projectIntelligence,
      memory: supervisorMemoryAdapter,
      research: supervisorResearchAdapter,
      now: deps.clock.nowMs,
    }),
  };
}

export function createSupervisorProjectIntelligenceAdapter(
  localAde: LocalAdeRepoSnapshotIndexSource,
  scopeResolutionUseCases: ScopeResolutionUseCases
): SupervisorProjectIntelligencePort {
  return new ScopeSupervisorProjectIntelligenceAdapter({
    index: new LocalAdeRepoSnapshotIndexAdapter(localAde),
    scopeResolver: scopeResolutionUseCases.scopeResolver,
    importGraph: new ScopeImportGraphService(),
  });
}
