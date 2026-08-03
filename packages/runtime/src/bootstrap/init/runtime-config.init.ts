import { ENV } from "#runtime/config/environment";
import type { SendMessagePolicy } from "#runtime/modules/ai";
import type { AuthRuntimePolicy } from "#runtime/platform/auth/auth";
import type { AppConfig } from "#runtime/shared/types/settings.types";
import type { ServerLifecyclePolicy } from "../lifecycle";
import type { ServerRuntimePolicy } from "../server-runtime-policy";

export interface AppRuntimeConfig {
  sqliteWorkerEnabled: boolean;
  allowedAgentCommandPolicies: typeof ENV.allowedAgentCommandPolicies;
  allowedEnvKeys: string[];
  agentTimeoutMs: number | undefined;
  sessionBufferLimit: number;
  sessionUiMessageLimit: number;
  sessionLockAcquireTimeoutMs: number;
  sessionEventBusPublishMaxQueuePerChat: number;
  sendMessagePolicy: SendMessagePolicy;
  supervisorPolicy: {
    enabled: boolean;
    model: string;
    miniMaxApiKey?: string;
    decisionTimeoutMs: number;
    decisionMaxAttempts: number;
    maxRuntimeMs: number;
    maxRepeatedPrompts: number;
    customSystemPrompt: string;
    toolPolicy: NonNullable<AppConfig["supervisorToolPolicy"]>;
    toolAllowlist: string[];
    webSearchProvider: typeof ENV.supervisorWebSearchProvider;
    webSearchApiKey?: string;
    memoryProvider: typeof ENV.supervisorMemoryProvider;
    obsidianCommand: string;
    obsidianVault?: string;
    obsidianBlueprintPath?: string;
    obsidianLogPath?: string;
    obsidianSearchPath: string;
    obsidianSearchLimit: number;
    obsidianTimeoutMs: number;
  };
  authPolicy: AuthRuntimePolicy;
  lifecyclePolicy: ServerLifecyclePolicy;
  serverPolicy: ServerRuntimePolicy;
}

export function resolveAppRuntimeConfig(): AppRuntimeConfig {
  return {
    sqliteWorkerEnabled: ENV.sqliteWorkerEnabled,
    allowedAgentCommandPolicies: ENV.allowedAgentCommandPolicies,
    allowedEnvKeys: ENV.allowedEnvKeys,
    agentTimeoutMs: ENV.agentTimeoutMs,
    sessionBufferLimit: ENV.sessionBufferLimit,
    sessionUiMessageLimit: ENV.sessionUiMessageLimit,
    sessionLockAcquireTimeoutMs: ENV.sessionLockAcquireTimeoutMs,
    sessionEventBusPublishMaxQueuePerChat:
      ENV.sessionEventBusPublishMaxQueuePerChat,
    sendMessagePolicy: {
      messageContentMaxBytes: ENV.messageContentMaxBytes,
      messagePartsMaxBytes: ENV.messagePartsMaxBytes,
      acpRetryMaxAttempts: ENV.acpRequestMaxAttempts,
      acpRetryBaseDelayMs: ENV.acpRequestRetryBaseDelayMs,
    },
    supervisorPolicy: {
      enabled: ENV.supervisorEnabled,
      model: ENV.supervisorModel,
      ...(ENV.supervisorMiniMaxApiKey.length > 0
        ? { miniMaxApiKey: ENV.supervisorMiniMaxApiKey }
        : {}),
      decisionTimeoutMs: ENV.supervisorDecisionTimeoutMs,
      decisionMaxAttempts: ENV.supervisorDecisionMaxAttempts,
      maxRuntimeMs: ENV.supervisorMaxRuntimeMs,
      maxRepeatedPrompts: ENV.supervisorMaxRepeatedPrompts,
      customSystemPrompt: ENV.supervisorCustomSystemPrompt,
      toolPolicy: ENV.supervisorToolPolicy,
      toolAllowlist: [...ENV.supervisorToolAllowlist],
      webSearchProvider: ENV.supervisorWebSearchProvider,
      webSearchApiKey: ENV.supervisorWebSearchApiKey,
      memoryProvider: ENV.supervisorMemoryProvider,
      obsidianCommand: ENV.supervisorObsidianCommand,
      ...(ENV.supervisorObsidianVault.length > 0
        ? { obsidianVault: ENV.supervisorObsidianVault }
        : {}),
      ...(ENV.supervisorObsidianBlueprintPath.length > 0
        ? { obsidianBlueprintPath: ENV.supervisorObsidianBlueprintPath }
        : {}),
      ...(ENV.supervisorObsidianLogPath.length > 0
        ? { obsidianLogPath: ENV.supervisorObsidianLogPath }
        : {}),
      obsidianSearchPath: ENV.supervisorObsidianSearchPath,
      obsidianSearchLimit: ENV.supervisorObsidianSearchLimit,
      obsidianTimeoutMs: ENV.supervisorObsidianTimeoutMs,
    },
    authPolicy: {
      authBaseUrl: ENV.authBaseUrl,
      authTrustedOrigins: ENV.authTrustedOrigins,
      authApiKeyPrefix: ENV.authApiKeyPrefix,
      authApiKeyRateLimitEnabled: ENV.authApiKeyRateLimitEnabled,
      authApiKeyRateLimitTimeWindowMs: ENV.authApiKeyRateLimitTimeWindowMs,
      authApiKeyRateLimitMaxRequests: ENV.authApiKeyRateLimitMaxRequests,
      oauthProviders: ENV.authOAuthProviders,
    },
    lifecyclePolicy: {
      sqliteRetentionHotDays: ENV.sqliteRetentionHotDays,
      backgroundTaskTimeoutMs: ENV.backgroundTaskTimeoutMs,
      sqliteRetentionCompactionBatchSize:
        ENV.sqliteRetentionCompactionBatchSize,
      authBootstrapApiKey: ENV.authBootstrapApiKey,
      authApiKeyPrefix: ENV.authApiKeyPrefix,
    },
    serverPolicy: {
      wsHost: ENV.wsHost,
      wsPort: ENV.wsPort,
      wsMaxPayloadBytes: ENV.wsMaxPayloadBytes,
      wsAuthTimeoutMs: ENV.wsAuthTimeoutMs,
      wsSessionRevalidateIntervalMs: ENV.wsSessionRevalidateIntervalMs,
      httpMaxBodyBytes: ENV.httpMaxBodyBytes,
      corsStrictOrigin: ENV.corsStrictOrigin,
      authAllowSignup: ENV.authAllowSignup,
      authRequireCloudflareAccess: ENV.authRequireCloudflareAccess,
      authCloudflareAccessClientId: ENV.authCloudflareAccessClientId,
      authCloudflareAccessClientSecret: ENV.authCloudflareAccessClientSecret,
      authCloudflareAccessJwtPublicKeyPem:
        ENV.authCloudflareAccessJwtPublicKeyPem,
      authCloudflareAccessJwtAudience: ENV.authCloudflareAccessJwtAudience,
      authCloudflareAccessJwtIssuer: ENV.authCloudflareAccessJwtIssuer,
      isDev: ENV.isDev,
      defaultAdminUsername: ENV.authAdminUsername ?? "admin",
      runtimeNodeRole: ENV.runtimeNodeRole,
      runtimeWriterUrl: ENV.runtimeWriterUrl,
      runtimeInternalToken: ENV.runtimeInternalToken,
    },
  };
}

export function applyAppConfigToRuntimeConfig(
  runtimeConfig: AppRuntimeConfig,
  appConfig: AppConfig
): void {
  runtimeConfig.supervisorPolicy.enabled = appConfig.supervisorEnabled;
  runtimeConfig.supervisorPolicy.model = appConfig.supervisorModel.trim();
  runtimeConfig.supervisorPolicy.decisionTimeoutMs =
    appConfig.supervisorDecisionTimeoutMs;
  runtimeConfig.supervisorPolicy.decisionMaxAttempts =
    appConfig.supervisorDecisionMaxAttempts;
  runtimeConfig.supervisorPolicy.maxRuntimeMs =
    appConfig.supervisorMaxRuntimeMs;
  runtimeConfig.supervisorPolicy.maxRepeatedPrompts =
    appConfig.supervisorMaxRepeatedPrompts;
  runtimeConfig.supervisorPolicy.customSystemPrompt =
    appConfig.supervisorCustomSystemPrompt.trim();
  runtimeConfig.supervisorPolicy.toolPolicy = appConfig.supervisorToolPolicy;
  runtimeConfig.supervisorPolicy.toolAllowlist = [
    ...appConfig.supervisorToolAllowlist,
  ];
  runtimeConfig.supervisorPolicy.webSearchProvider =
    appConfig.supervisorWebSearchProvider;
  runtimeConfig.supervisorPolicy.memoryProvider =
    appConfig.supervisorMemoryProvider;
  runtimeConfig.supervisorPolicy.obsidianCommand =
    appConfig.supervisorObsidianCommand.trim() || "obsidian";
  runtimeConfig.supervisorPolicy.obsidianSearchPath =
    appConfig.supervisorObsidianSearchPath.trim() || "Project";
  runtimeConfig.supervisorPolicy.obsidianSearchLimit =
    appConfig.supervisorObsidianSearchLimit;
  runtimeConfig.supervisorPolicy.obsidianTimeoutMs =
    appConfig.supervisorObsidianTimeoutMs;
  const miniMaxApiKey = appConfig.supervisorMiniMaxApiKey.trim();
  if (miniMaxApiKey.length > 0) {
    runtimeConfig.supervisorPolicy.miniMaxApiKey = miniMaxApiKey;
  } else {
    runtimeConfig.supervisorPolicy.miniMaxApiKey = undefined;
  }
  const webSearchApiKey = appConfig.supervisorWebSearchApiKey.trim();
  if (webSearchApiKey.length > 0) {
    runtimeConfig.supervisorPolicy.webSearchApiKey = webSearchApiKey;
  } else {
    runtimeConfig.supervisorPolicy.webSearchApiKey = undefined;
  }
  const obsidianVault = appConfig.supervisorObsidianVault.trim();
  runtimeConfig.supervisorPolicy.obsidianVault =
    obsidianVault.length > 0 ? obsidianVault : undefined;
  const obsidianBlueprintPath =
    appConfig.supervisorObsidianBlueprintPath.trim();
  runtimeConfig.supervisorPolicy.obsidianBlueprintPath =
    obsidianBlueprintPath.length > 0 ? obsidianBlueprintPath : undefined;
  const obsidianLogPath = appConfig.supervisorObsidianLogPath.trim();
  runtimeConfig.supervisorPolicy.obsidianLogPath =
    obsidianLogPath.length > 0 ? obsidianLogPath : undefined;
}
