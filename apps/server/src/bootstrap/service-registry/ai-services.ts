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
  const setModelService = new SetModelService(sessionGateway, {
    acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
    acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
  });
  const setModeService = new SetModeService(sessionGateway, {
    acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
    acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
  });
  const setConfigOptionService = new SetConfigOptionService(sessionGateway, {
    acpRetryMaxAttempts: deps.sendMessagePolicy.acpRetryMaxAttempts,
    acpRetryBaseDelayMs: deps.sendMessagePolicy.acpRetryBaseDelayMs,
  });
  const cancelPromptService = new CancelPromptService(
    deps.sessionRuntime,
    sessionGateway
  );

  return {
    sendMessage: () => sendMessageService,
    setModel: () => setModelService,
    setMode: () => setModeService,
    setConfigOption: () => setConfigOptionService,
    cancelPrompt: () => cancelPromptService,
  };
}
