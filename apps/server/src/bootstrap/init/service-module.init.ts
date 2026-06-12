import { GetMeService } from "@/modules/auth";
import type { AppConfigService } from "@/modules/settings";
import type { AppUseCases, AuthUseCases } from "@/modules/use-cases";
import { AuthUserReadAdapter } from "@/platform/auth/adapters/auth-user-read.adapter";
import type { AuthRuntime } from "@/platform/auth/auth";
import {
  type AuthContext,
  createAuthContextResolver,
} from "@/platform/auth/guards";
import { getResponseCache } from "@/platform/caching/response-cache";
import type { CacheStats } from "@/platform/caching/types";
import { GitAdapter } from "@/platform/git";
import { AgentRuntimeAdapter } from "@/platform/process";
import type { BackgroundRunnerState } from "@/shared/types/background.types";
import { createServerLifecycle, type ServerLifecycle } from "../lifecycle";
import { createAgentUseCases } from "../service-registry/agent-services";
import { createAiUseCases } from "../service-registry/ai-services";
import type { ServiceRegistryDependencies } from "../service-registry/dependencies";
import { createOpsUseCases } from "../service-registry/ops-services";
import { createProjectUseCases } from "../service-registry/project-services";
import { createSessionUseCases } from "../service-registry/session-services";
import { createSettingsUseCases } from "../service-registry/settings-services";
import { createToolingUseCases } from "../service-registry/tooling-services";
import type { CoreModule } from "./core-module.init";
import type { PersistenceModule } from "./persistence-module.init";
import type { AppRuntimeConfig } from "./runtime-config.init";

export type ResolveAuthContext = (req?: {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
}) => Promise<AuthContext | null>;

export interface ServiceModule {
  useCases: AppUseCases;
  lifecycle: ServerLifecycle;
  resolveAuthContext: ResolveAuthContext;
  setBackgroundRunnerStateProvider: (
    provider: () => BackgroundRunnerState
  ) => void;
  getBackgroundRunnerState: () => BackgroundRunnerState | null;
}

interface ServiceModuleInitParams {
  core: CoreModule;
  persistence: PersistenceModule;
  appConfigService: AppConfigService;
  runtimeConfig: AppRuntimeConfig;
  authRuntime: AuthRuntime;
}

export function initializeServiceModule({
  core,
  persistence,
  appConfigService,
  runtimeConfig,
  authRuntime,
}: ServiceModuleInitParams): ServiceModule {
  const gitAdapter = new GitAdapter();
  const agentRuntimeAdapter = new AgentRuntimeAdapter({
    allowedAgentCommandPolicies: runtimeConfig.allowedAgentCommandPolicies,
    allowedEnvKeys: runtimeConfig.allowedEnvKeys,
    agentTimeoutMs: runtimeConfig.agentTimeoutMs,
  });

  let backgroundRunnerStateProvider: (() => BackgroundRunnerState) | undefined;
  const setBackgroundRunnerStateProvider = (
    provider: () => BackgroundRunnerState
  ) => {
    backgroundRunnerStateProvider = provider;
  };
  const getBackgroundRunnerState = (): BackgroundRunnerState | null => {
    if (!backgroundRunnerStateProvider) {
      return null;
    }
    return backgroundRunnerStateProvider();
  };

  const getCacheStats = (): CacheStats => getResponseCache().getStats();
  const serviceRegistryDependencies: ServiceRegistryDependencies = {
    ...core,
    ...persistence,
    appConfigService,
    gitAdapter,
    agentRuntimeAdapter,
    sendMessagePolicy: runtimeConfig.sendMessagePolicy,
    supervisorPolicy: runtimeConfig.supervisorPolicy,
    sessionUiMessageLimit: runtimeConfig.sessionUiMessageLimit,
    getCacheStats,
    getBackgroundRunnerState,
  };

  const sessionUseCases = createSessionUseCases(serviceRegistryDependencies);
  const aiUseCases = createAiUseCases(serviceRegistryDependencies);
  const projectUseCases = createProjectUseCases(serviceRegistryDependencies);
  const agentUseCases = createAgentUseCases(serviceRegistryDependencies);
  const settingsUseCases = createSettingsUseCases(serviceRegistryDependencies);
  const toolingUseCases = createToolingUseCases(serviceRegistryDependencies);
  const opsUseCases = createOpsUseCases(serviceRegistryDependencies);
  const authUserRead = new AuthUserReadAdapter(authRuntime.authDb);
  const authUseCases: AuthUseCases = {
    getMe: new GetMeService(authUserRead),
  };
  const useCases: AppUseCases = {
    session: sessionUseCases,
    ai: aiUseCases,
    project: projectUseCases,
    agent: agentUseCases,
    settings: settingsUseCases,
    tooling: toolingUseCases,
    auth: authUseCases,
    ops: opsUseCases,
  };
  const lifecycle = createServerLifecycle({
    authRuntime,
    agentRuntime: agentRuntimeAdapter,
    sessionRuntime: core.sessionRuntime,
    sessionRepo: persistence.sessionRepo,
    sessionEventOutbox: core.sessionEventOutbox,
    eventBus: core.eventBus,
    sessionUseCases,
    localAde: settingsUseCases.localAde,
    appConfig: appConfigService,
    policy: runtimeConfig.lifecyclePolicy,
    setBackgroundRunnerStateProvider,
  });
  const resolveAuthContext: ResolveAuthContext = createAuthContextResolver(
    authRuntime.auth
  );

  return {
    useCases,
    lifecycle,
    resolveAuthContext,
    setBackgroundRunnerStateProvider,
    getBackgroundRunnerState,
  };
}
