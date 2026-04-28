import {
  CancelPromptService,
  PromptTaskRunner,
  SendMessageService,
  SetConfigOptionService,
  SetModelService,
  SetModeService,
} from "@/modules/ai";
import { AiSessionRuntimeAdapter } from "@/modules/ai/di";
import type { AiServiceFactory } from "@/modules/service-factories";
import {
  SetSupervisorModeService,
  type SupervisorAuditPort,
  SupervisorLoopService,
  type SupervisorMemoryPort,
  SupervisorPermissionService,
  type SupervisorResearchPort,
} from "@/modules/supervisor";
import {
  AiSdkSupervisorDecisionAdapter,
  ExaSupervisorResearchAdapter,
  NoopSupervisorAuditAdapter,
  NoopSupervisorMemoryAdapter,
  NoopSupervisorResearchAdapter,
  ObsidianSupervisorMemoryAdapter,
} from "@/modules/supervisor/di";
import type { ServiceRegistryDependencies } from "./dependencies";

export function createAiServices(
  deps: ServiceRegistryDependencies
): AiServiceFactory {
  const sessionGateway = new AiSessionRuntimeAdapter(
    deps.sessionRuntime,
    deps.sessionRepo,
    {
      promptMetaPolicyProvider: () => {
        const config = deps.appConfigService.getConfig();
        return {
          acpPromptMetaPolicy: config.acpPromptMetaPolicy,
          acpPromptMetaAllowlist: config.acpPromptMetaAllowlist,
        };
      },
    }
  );
  const promptTaskRunner = new PromptTaskRunner({
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    sessionGateway,
    logger: deps.appLogger,
    clock: deps.clock,
    policy: {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    },
    runtimePolicyProvider: () => ({
      maxTokens: deps.appConfigService.getConfig().maxTokens,
    }),
  });
  const sendMessageService = new SendMessageService({
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    sessionGateway,
    promptTaskRunner,
    logger: deps.appLogger,
    inputPolicy: deps.sendMessagePolicy,
    clock: deps.clock,
  });
  const setModelService = new SetModelService(
    deps.sessionRuntime,
    sessionGateway,
    {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    }
  );
  const setModeService = new SetModeService(
    deps.sessionRuntime,
    sessionGateway,
    {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    }
  );
  const setConfigOptionService = new SetConfigOptionService(
    deps.sessionRuntime,
    sessionGateway,
    {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    }
  );
  const cancelPromptService = new CancelPromptService(
    deps.sessionRuntime,
    sessionGateway
  );
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
  const supervisorLoopService = new SupervisorLoopService({
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    sendMessage: sendMessageService,
    decisionPort: supervisorDecisionAdapter,
    researchPort: supervisorResearchAdapter,
    memoryPort: supervisorMemoryAdapter,
    auditPort: supervisorAuditAdapter,
    policy: deps.supervisorPolicy,
    logger: deps.appLogger,
    clock: deps.clock,
  });
  const setSupervisorModeService = new SetSupervisorModeService({
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    policy: deps.supervisorPolicy,
    clock: deps.clock,
  });
  const supervisorPermissionService = new SupervisorPermissionService({
    sessionRuntime: deps.sessionRuntime,
    sessionRepo: deps.sessionRepo,
    decisionPort: supervisorDecisionAdapter,
    memoryPort: supervisorMemoryAdapter,
    policy: deps.supervisorPolicy,
    logger: deps.appLogger,
    clock: deps.clock,
  });
  promptTaskRunner.setAfterTurnCompleteHook((event) => {
    supervisorLoopService.scheduleReview(event);
  });
  deps.sessionAcpAdapter.setPermissionAutoResolver((input) =>
    supervisorPermissionService.handlePermissionRequest(input)
  );

  return {
    sendMessage: () => sendMessageService,
    setModel: () => setModelService,
    setMode: () => setModeService,
    setConfigOption: () => setConfigOptionService,
    cancelPrompt: () => cancelPromptService,
    setSupervisorMode: () => setSupervisorModeService,
  };
}
