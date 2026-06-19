import {
  SetSupervisorModeService,
  type SupervisorAuditPort,
  SupervisorLoopService,
  type SupervisorMemoryContext,
  type SupervisorMemoryLogInput,
  type SupervisorMemoryLookupInput,
  type SupervisorMemoryPort,
  SupervisorPermissionService,
  type SupervisorPolicy,
  type SupervisorResearchPort,
  type SupervisorResearchResult,
} from "#runtime/modules/supervisor";
import {
  AiSdkSupervisorDecisionAdapter,
  ExaSupervisorResearchAdapter,
  NoopSupervisorAuditAdapter,
  NoopSupervisorMemoryAdapter,
  NoopSupervisorResearchAdapter,
  ObsidianSupervisorMemoryAdapter,
} from "#runtime/modules/supervisor/di";
import type {
  AiUseCases,
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
  aiUseCases: Pick<AiUseCases, "sendMessage">
): SupervisorUseCases {
  const supervisorDecisionAdapter = new AiSdkSupervisorDecisionAdapter(
    deps.supervisorPolicy,
    deps.appLogger
  );
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
    }),
    setMode: new SetSupervisorModeService({
      sessionRepo: deps.sessionRepo,
      sessionRuntime: deps.sessionRuntime,
      policy: deps.supervisorPolicy,
      clock: deps.clock,
    }),
    permission: new SupervisorPermissionService({
      sessionRuntime: deps.sessionRuntime,
      sessionRepo: deps.sessionRepo,
      decisionPort: supervisorDecisionAdapter,
      memoryPort: supervisorMemoryAdapter,
      policy: deps.supervisorPolicy,
      logger: deps.appLogger,
      clock: deps.clock,
    }),
  };
}
