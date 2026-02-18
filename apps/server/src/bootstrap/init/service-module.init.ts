import { GetMeService } from "@/modules/auth";
import type {
  AgentServiceFactory,
  AiServiceFactory,
  AuthServiceFactory,
  OpsServiceFactory,
  ProjectServiceFactory,
  SessionServiceFactory,
  SettingsServiceFactory,
  ToolingServiceFactory,
} from "@/modules/service-factories";
import type { AppConfigService } from "@/modules/settings";
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
import { createAgentServices } from "../service-registry/agent-services";
import { createAiServices } from "../service-registry/ai-services";
import type { ServiceRegistryDependencies } from "../service-registry/dependencies";
import { createOpsServices } from "../service-registry/ops-services";
import { createProjectServices } from "../service-registry/project-services";
import { createSessionServices } from "../service-registry/session-services";
import { createSettingsServices } from "../service-registry/settings-services";
import { createToolingServices } from "../service-registry/tooling-services";
import type { CoreModule } from "./core-module.init";
import type { PersistenceModule } from "./persistence-module.init";
import type { AppRuntimeConfig } from "./runtime-config.init";

export type ResolveAuthContext = (req?: {
  headers: Headers | Record<string, string | string[] | undefined>;
  url?: string;
  remoteAddress?: string;
}) => Promise<AuthContext | null>;

export interface ServiceModule {
  sessionServices: SessionServiceFactory;
  aiServices: AiServiceFactory;
  projectServices: ProjectServiceFactory;
  agentServices: AgentServiceFactory;
  settingsServices: SettingsServiceFactory;
  toolingServices: ToolingServiceFactory;
  authServices: AuthServiceFactory;
  opsServices: OpsServiceFactory;
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
    getCacheStats,
    getBackgroundRunnerState,
  };

  const sessionServices = createSessionServices(serviceRegistryDependencies);
  const aiServices = createAiServices(serviceRegistryDependencies);
  const projectServices = createProjectServices(serviceRegistryDependencies);
  const agentServices = createAgentServices(serviceRegistryDependencies);
  const settingsServices = createSettingsServices(serviceRegistryDependencies);
  const toolingServices = createToolingServices(serviceRegistryDependencies);
  const opsServices = createOpsServices(serviceRegistryDependencies);
  const authUserRead = new AuthUserReadAdapter(authRuntime.authDb);
  const authServices: AuthServiceFactory = {
    getMe: () => new GetMeService(authUserRead),
  };
  const lifecycle = createServerLifecycle({
    authRuntime,
    agentRuntime: agentRuntimeAdapter,
    sessionRuntime: core.sessionRuntime,
    sessionRepo: persistence.sessionRepo,
    sessionEventOutbox: core.sessionEventOutbox,
    eventBus: core.eventBus,
    sessionServices,
    appConfig: appConfigService,
    policy: runtimeConfig.lifecyclePolicy,
    setBackgroundRunnerStateProvider,
  });
  const resolveAuthContext: ResolveAuthContext = createAuthContextResolver(
    authRuntime.auth
  );

  return {
    sessionServices,
    aiServices,
    projectServices,
    agentServices,
    settingsServices,
    toolingServices,
    authServices,
    opsServices,
    lifecycle,
    resolveAuthContext,
    setBackgroundRunnerStateProvider,
    getBackgroundRunnerState,
  };
}
