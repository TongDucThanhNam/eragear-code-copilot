import {
  SetSupervisorModeService,
  type SupervisorAuditPort,
  SupervisorLoopService,
  type SupervisorMemoryPort,
  SupervisorPermissionService,
  type SupervisorResearchPort,
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
import type { ServiceRegistrySlice } from "./dependencies";

type SupervisorServiceDependencies = ServiceRegistrySlice<
  | "supervisorPolicy"
  | "appLogger"
  | "sessionRepo"
  | "sessionRuntime"
  | "projectRepo"
  | "clock"
>;

export function createSupervisorUseCases(
  deps: SupervisorServiceDependencies,
  aiUseCases: Pick<AiUseCases, "sendMessage">
): SupervisorUseCases {
  const supervisorDecisionAdapter = new AiSdkSupervisorDecisionAdapter(
    deps.supervisorPolicy,
    deps.appLogger
  );
  const supervisorResearchAdapter: SupervisorResearchPort =
    deps.supervisorPolicy.webSearchProvider === "exa" &&
    deps.supervisorPolicy.webSearchApiKey
      ? new ExaSupervisorResearchAdapter(
          deps.supervisorPolicy.webSearchApiKey,
          deps.appLogger
        )
      : new NoopSupervisorResearchAdapter();
  const supervisorMemoryAdapter: SupervisorMemoryPort =
    deps.supervisorPolicy.memoryProvider === "obsidian"
      ? new ObsidianSupervisorMemoryAdapter(
          {
            command: deps.supervisorPolicy.obsidianCommand,
            ...(deps.supervisorPolicy.obsidianVault
              ? { vault: deps.supervisorPolicy.obsidianVault }
              : {}),
            ...(deps.supervisorPolicy.obsidianBlueprintPath
              ? { blueprintPath: deps.supervisorPolicy.obsidianBlueprintPath }
              : {}),
            ...(deps.supervisorPolicy.obsidianLogPath
              ? { logPath: deps.supervisorPolicy.obsidianLogPath }
              : {}),
            searchPath: deps.supervisorPolicy.obsidianSearchPath,
            searchLimit: deps.supervisorPolicy.obsidianSearchLimit,
            timeoutMs: deps.supervisorPolicy.obsidianTimeoutMs,
          },
          deps.appLogger
        )
      : new NoopSupervisorMemoryAdapter();
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
