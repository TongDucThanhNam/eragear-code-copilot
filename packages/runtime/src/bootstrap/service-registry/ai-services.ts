import {
  CancelPromptService,
  createEventBusPromptLifecycleNotifier,
  PromptTaskRunner,
  SendMessageService,
  SetConfigOptionService,
  SetModelService,
  SetModeService,
} from "#runtime/modules/ai";
import { AiSessionRuntimeAdapter } from "#runtime/modules/ai/di";
import { SessionRealtimeGate } from "#runtime/modules/session";
import type { AiUseCases } from "#runtime/modules/use-cases";
import type { ServiceRegistrySlice } from "./dependencies";

type AiServiceDependencies = ServiceRegistrySlice<
  | "sessionRuntime"
  | "appLogger"
  | "sessionRepo"
  | "appConfigService"
  | "eventBus"
  | "clock"
  | "sendMessagePolicy"
  | "promptEnhancer"
  | "outputStylePrompt"
>;

interface AiServiceRegistryOptions {
  sessionRealtimeGate?: SessionRealtimeGate;
}

export function createAiUseCases(
  deps: AiServiceDependencies,
  options: AiServiceRegistryOptions = {}
): AiUseCases {
  const sessionRealtimeGate =
    options.sessionRealtimeGate ??
    new SessionRealtimeGate({
      sessionRuntime: deps.sessionRuntime,
      logger: deps.appLogger,
    });
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
  const promptLifecycleEvents = createEventBusPromptLifecycleNotifier({
    eventBus: deps.eventBus,
    logger: deps.appLogger,
  });
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
    afterTurnComplete: promptLifecycleEvents.afterTurnComplete,
  });
  const sendMessageService = new SendMessageService({
    sessionRepo: deps.sessionRepo,
    sessionRuntime: deps.sessionRuntime,
    sessionGateway,
    sessionRealtimeGate,
    promptTaskRunner,
    promptLifecycleEvents,
    logger: deps.appLogger,
    inputPolicy: deps.sendMessagePolicy,
    clock: deps.clock,
    ...(deps.promptEnhancer ? { promptEnhancer: deps.promptEnhancer } : {}),
    ...(deps.outputStylePrompt
      ? { outputStylePrompt: deps.outputStylePrompt }
      : {}),
  });
  const setModelService = new SetModelService(
    deps.sessionRuntime,
    sessionGateway,
    {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    },
    deps.sessionRepo
  );
  const setModeService = new SetModeService(
    deps.sessionRuntime,
    sessionGateway,
    {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    },
    deps.sessionRepo
  );
  const setConfigOptionService = new SetConfigOptionService(
    deps.sessionRuntime,
    sessionGateway,
    {
      acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
      acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
    },
    deps.sessionRepo
  );
  const cancelPromptService = new CancelPromptService(
    deps.sessionRuntime,
    sessionGateway
  );

  return {
    sendMessage: sendMessageService,
    setModel: setModelService,
    setMode: setModeService,
    setConfigOption: setConfigOptionService,
    cancelPrompt: cancelPromptService,
  };
}
