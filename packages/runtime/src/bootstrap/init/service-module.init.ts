import { GetMeService } from "#runtime/modules/auth";
import { SessionRealtimeGate } from "#runtime/modules/session";
import type {
  AppConfigService,
  UiSettingsService,
} from "#runtime/modules/settings";
import type { AppUseCases, AuthUseCases } from "#runtime/modules/use-cases";
import { AuthUserReadAdapter } from "#runtime/platform/auth/adapters/auth-user-read.adapter";
import type { AuthRuntime } from "#runtime/platform/auth/auth";
import {
  type AuthContext,
  createAuthContextResolver,
} from "#runtime/platform/auth/guards";
import { getResponseCache } from "#runtime/platform/caching/response-cache";
import type { CacheStats } from "#runtime/platform/caching/types";
import { GitAdapter } from "#runtime/platform/git";
import { GitWorkflowAdapter } from "#runtime/platform/git/workflow";
import { AgentRuntimeAdapter } from "#runtime/platform/process";
import type { BackgroundRunnerState } from "#runtime/shared/types/background.types";
import { createServerLifecycle, type ServerLifecycle } from "../lifecycle";
import { createAcpAuthUseCases } from "../service-registry/acp-auth-services";
import { createAgentUseCases } from "../service-registry/agent-services";
import { createAiUseCases } from "../service-registry/ai-services";
import { createBotsUseCases } from "../service-registry/bots-services";
import { createCodingPlanSubscriptionUseCases } from "../service-registry/coding-plan-subscription-services";
import { createCommandsUseCases } from "../service-registry/commands-services";
import { createContextUsageUseCases } from "../service-registry/context-usage-services";
import { createCrashReportingUseCases } from "../service-registry/crash-reporting-services";
import { createCredentialUseCases } from "../service-registry/credential-services";
import type { ServiceRegistryDependencies } from "../service-registry/dependencies";
import { createFeedbackUseCases } from "../service-registry/feedback-services";
import { createFileWatcherUseCases } from "../service-registry/file-watcher-services";
import { createGitUseCases } from "../service-registry/git-services";
import { createGoalModeUseCases } from "../service-registry/goal-mode-services";
import { createHooksUseCases } from "../service-registry/hooks-services";
import { createMemoryUseCases } from "../service-registry/memory-services";
import { createModelProviderUseCases } from "../service-registry/model-provider-services";
import { createOAuthUseCases } from "../service-registry/oauth-services";
import { createOpsUseCases } from "../service-registry/ops-services";
import { createOutputStyleUseCases } from "../service-registry/output-style-services";
import { createPluginsUseCases } from "../service-registry/plugins-services";
import { createProjectUseCases } from "../service-registry/project-services";
import { createPromptEnhancementUseCases } from "../service-registry/prompt-enhancement-services";
import { createQuotaUseCases } from "../service-registry/quota-services";
import { createRemoteControlUseCases } from "../service-registry/remote-control-services";
import { createRepoSnapshotIndexingUseCases } from "../service-registry/repo-snapshot-indexing-services";
import { createScopeResolutionUseCases } from "../service-registry/scope-resolution-services";
import { createSessionUseCases } from "../service-registry/session-services";
import { createSettingsUseCases } from "../service-registry/settings-services";
import { createSettingsSyncUseCases } from "../service-registry/settings-sync-services";
import { createSkillsUseCases } from "../service-registry/skills-services";
import { createSupervisorOrchestrationUseCases } from "../service-registry/supervisor-orchestration-services";
import {
  createSupervisorProjectIntelligenceAdapter,
  createSupervisorUseCases,
} from "../service-registry/supervisor-services";
import { createTaskAutoArchiveUseCases } from "../service-registry/task-auto-archive-services";
import { createTerminalUseCases } from "../service-registry/terminal-services";
import { createToolingUseCases } from "../service-registry/tooling-services";
import { createTrafficProxyUseCases } from "../service-registry/traffic-proxy-services";
import { createUsageStatsUseCases } from "../service-registry/usage-stats-services";
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
  dispose(): Promise<void>;
}

interface ServiceModuleInitParams {
  core: CoreModule;
  persistence: PersistenceModule;
  appConfigService: AppConfigService;
  uiSettingsService: UiSettingsService;
  runtimeConfig: AppRuntimeConfig;
  authRuntime: AuthRuntime;
}

export function initializeServiceModule({
  core,
  persistence,
  appConfigService,
  uiSettingsService,
  runtimeConfig,
  authRuntime,
}: ServiceModuleInitParams): ServiceModule {
  const gitAdapter = new GitAdapter();
  const gitWorkflowAdapter = new GitWorkflowAdapter(gitAdapter);
  const trafficProxyUseCases = createTrafficProxyUseCases();
  const crashReportingUseCases = createCrashReportingUseCases();
  const agentRuntimeAdapter = new AgentRuntimeAdapter({
    allowedAgentCommandPolicies: runtimeConfig.allowedAgentCommandPolicies,
    allowedEnvKeys: runtimeConfig.allowedEnvKeys,
    agentTimeoutMs: runtimeConfig.agentTimeoutMs,
    trafficProxyEnvironment: () =>
      trafficProxyUseCases.trafficProxy.getAgentEnvironment(),
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
  const promptEnhancementUseCases = createPromptEnhancementUseCases();
  const outputStyleUseCases = createOutputStyleUseCases();
  const serviceRegistryDependencies: ServiceRegistryDependencies = {
    ...core,
    ...persistence,
    appConfigService,
    uiSettingsService,
    gitAdapter,
    gitWorkflowAdapter,
    agentRuntimeAdapter,
    sendMessagePolicy: runtimeConfig.sendMessagePolicy,
    promptEnhancer: promptEnhancementUseCases.promptEnhancement,
    outputStylePrompt: outputStyleUseCases.outputStyle,
    supervisorPolicy: runtimeConfig.supervisorPolicy,
    sessionUiMessageLimit: runtimeConfig.sessionUiMessageLimit,
    getCacheStats,
    getBackgroundRunnerState,
  };

  const sessionRealtimeGate = new SessionRealtimeGate({
    sessionRuntime: core.sessionRuntime,
    logger: core.appLogger,
  });
  const sessionUseCases = createSessionUseCases(serviceRegistryDependencies, {
    realtimeGate: sessionRealtimeGate,
  });
  const aiUseCases = createAiUseCases(serviceRegistryDependencies, {
    sessionRealtimeGate,
  });
  const projectUseCases = createProjectUseCases(serviceRegistryDependencies);
  const agentUseCases = createAgentUseCases(serviceRegistryDependencies);
  const settingsUseCases = createSettingsUseCases(serviceRegistryDependencies);
  const settingsSyncUseCases = createSettingsSyncUseCases(
    serviceRegistryDependencies,
    settingsUseCases.update
  );
  const toolingUseCases = createToolingUseCases(serviceRegistryDependencies);
  const opsUseCases = createOpsUseCases(serviceRegistryDependencies);
  const gitUseCases = createGitUseCases(serviceRegistryDependencies, {
    conversationRollback: sessionUseCases.rollbackConversation,
  });
  const credentialUseCases = createCredentialUseCases();
  const modelProviderUseCases = createModelProviderUseCases();
  const quotaUseCases = createQuotaUseCases(
    serviceRegistryDependencies,
    credentialUseCases,
    modelProviderUseCases
  );
  const commandsUseCases = createCommandsUseCases(
    serviceRegistryDependencies,
    settingsUseCases.localAde
  );
  const skillsUseCases = createSkillsUseCases(serviceRegistryDependencies);
  const hooksUseCases = createHooksUseCases(settingsUseCases.localAde);
  const memoryUseCases = createMemoryUseCases(settingsUseCases.localAde);
  const fileWatcherUseCases = createFileWatcherUseCases(
    serviceRegistryDependencies
  );
  const contextUsageUseCases = createContextUsageUseCases(
    serviceRegistryDependencies
  );
  const acpAuthUseCases = createAcpAuthUseCases(credentialUseCases);
  const feedbackUseCases = createFeedbackUseCases();
  const terminalUseCases = createTerminalUseCases(serviceRegistryDependencies);
  const oauthUseCases = createOAuthUseCases(authRuntime);
  const codingPlanSubscriptionUseCases = createCodingPlanSubscriptionUseCases(
    serviceRegistryDependencies
  );
  const usageStatsUseCases = createUsageStatsUseCases(
    serviceRegistryDependencies,
    quotaUseCases.provider
  );
  const pluginsUseCases = createPluginsUseCases(settingsUseCases.localAde);
  const repoSnapshotIndexingUseCases = createRepoSnapshotIndexingUseCases(
    settingsUseCases.localAde
  );
  const scopeResolutionUseCases = createScopeResolutionUseCases(
    settingsUseCases.localAde
  );
  const supervisorProjectIntelligence =
    createSupervisorProjectIntelligenceAdapter(
      settingsUseCases.localAde,
      scopeResolutionUseCases
    );
  const supervisorOrchestrationUseCases = createSupervisorOrchestrationUseCases(
    serviceRegistryDependencies,
    sessionUseCases,
    aiUseCases,
    agentUseCases,
    credentialUseCases,
    toolingUseCases,
    quotaUseCases
  );
  const supervisorUseCases = createSupervisorUseCases(
    serviceRegistryDependencies,
    aiUseCases,
    {
      projectIntelligence: supervisorProjectIntelligence,
      session: sessionUseCases,
      agents: agentUseCases,
      profiles: supervisorOrchestrationUseCases.profiles,
      goalDraft: supervisorOrchestrationUseCases.orchestrator,
    }
  );
  core.sessionAcpAdapter.setPermissionAutoResolver(async (input) => {
    const handled =
      await supervisorOrchestrationUseCases.workerPermissions.handlePermissionRequest(
        input
      );
    if (!handled) {
      await supervisorUseCases.permission.handlePermissionRequest(input);
    }
  });
  const goalModeUseCases = createGoalModeUseCases(
    scopeResolutionUseCases,
    gitAdapter
  );
  const taskAutoArchiveUseCases = createTaskAutoArchiveUseCases(
    serviceRegistryDependencies
  );
  const remoteControlUseCases = createRemoteControlUseCases();
  const botsUseCases = createBotsUseCases({
    session: sessionUseCases,
    ai: aiUseCases,
    quota: quotaUseCases,
    supervisor: supervisorUseCases,
    supervisorOrchestration: supervisorOrchestrationUseCases,
    codingPlanSubscription: codingPlanSubscriptionUseCases,
    sessionStore: persistence.sessionRepo,
    sessionRuntime: core.sessionRuntime,
    projectStore: persistence.projectRepo,
    eventBus: core.eventBus,
    logger: core.appLogger,
  });
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
    git: gitUseCases,
    goalMode: goalModeUseCases,
    quota: quotaUseCases,
    supervisor: supervisorUseCases,
    supervisorOrchestration: supervisorOrchestrationUseCases,
    commands: commandsUseCases,
    skills: skillsUseCases,
    hooks: hooksUseCases,
    memory: memoryUseCases,
    fileWatcher: fileWatcherUseCases,
    contextUsage: contextUsageUseCases,
    credential: credentialUseCases,
    modelProvider: modelProviderUseCases,
    acpAuth: acpAuthUseCases,
    promptEnhancement: promptEnhancementUseCases,
    terminal: terminalUseCases,
    oauth: oauthUseCases,
    settingsSync: settingsSyncUseCases,
    feedback: feedbackUseCases,
    outputStyle: outputStyleUseCases,
    codingPlanSubscription: codingPlanSubscriptionUseCases,
    usageStats: usageStatsUseCases,
    plugins: pluginsUseCases,
    repoSnapshotIndexing: repoSnapshotIndexingUseCases,
    scopeResolution: scopeResolutionUseCases,
    taskAutoArchive: taskAutoArchiveUseCases,
    remoteControl: remoteControlUseCases,
    bots: botsUseCases,
    trafficProxy: trafficProxyUseCases,
    crashReporting: crashReportingUseCases,
  };
  installCrashReportingProcessHandlers({
    crashReporting: crashReportingUseCases.crashReporting,
    warn: (message, error) =>
      core.appLogger.warn(message, {
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  const lifecycle = createServerLifecycle({
    authRuntime,
    agentRuntime: agentRuntimeAdapter,
    sessionRuntime: core.sessionRuntime,
    sessionRepo: persistence.sessionRepo,
    sessionEventOutbox: core.sessionEventOutbox,
    sessionUseCases,
    supervisorOrchestration: supervisorOrchestrationUseCases,
    localAde: settingsUseCases.localAde,
    bots: botsUseCases.bots,
    taskAutoArchive: taskAutoArchiveUseCases.taskAutoArchive,
    appConfig: appConfigService,
    policy: runtimeConfig.lifecyclePolicy,
    setBackgroundRunnerStateProvider,
  });
  const resolveAuthContext: ResolveAuthContext = createAuthContextResolver(
    authRuntime.auth
  );

  acpAuthUseCases.acpAuth.syncStartup().catch((error) => {
    core.appLogger.warn("ACP auth startup sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    useCases,
    lifecycle,
    resolveAuthContext,
    setBackgroundRunnerStateProvider,
    getBackgroundRunnerState,
    async dispose() {
      fileWatcherUseCases.fileWatcher.dispose();
      await supervisorOrchestrationUseCases.telegramPolling.dispose();
      await supervisorOrchestrationUseCases.power.dispose();
    },
  };
}

let crashReportingHandlersInstalled = false;

function installCrashReportingProcessHandlers(params: {
  crashReporting: AppUseCases["crashReporting"]["crashReporting"];
  warn: (message: string, error: unknown) => void;
}): void {
  if (crashReportingHandlersInstalled) {
    return;
  }
  crashReportingHandlersInstalled = true;
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    params.crashReporting
      .captureSystem({
        source: "server",
        level: "error",
        message: error.message || "Unhandled promise rejection",
        stack: error.stack,
        metadata: { kind: "unhandledRejection" },
      })
      .catch((captureError) =>
        params.warn("Failed to archive unhandled rejection", captureError)
      );
  });
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    params.crashReporting
      .captureSystem({
        source: "server",
        level: "fatal",
        message: error.message || "Uncaught exception",
        stack: error.stack,
        metadata: { kind: "uncaughtException", origin },
      })
      .catch((captureError) =>
        params.warn("Failed to archive uncaught exception", captureError)
      );
  });
}
