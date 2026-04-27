import { ENV } from "@/config/environment";
import type { SendMessagePolicy } from "@/modules/ai";
import type { AuthRuntimePolicy } from "@/platform/auth/auth";
import type { ServerLifecyclePolicy } from "../lifecycle";
import type { ServerRuntimePolicy } from "../server";

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
    deepSeekApiKey?: string;
    decisionTimeoutMs: number;
    decisionMaxAttempts: number;
    maxRuntimeMs: number;
    maxRepeatedPrompts: number;
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
      ...(ENV.supervisorDeepSeekApiKey.length > 0
        ? { deepSeekApiKey: ENV.supervisorDeepSeekApiKey }
        : {}),
      decisionTimeoutMs: ENV.supervisorDecisionTimeoutMs,
      decisionMaxAttempts: ENV.supervisorDecisionMaxAttempts,
      maxRuntimeMs: ENV.supervisorMaxRuntimeMs,
      maxRepeatedPrompts: ENV.supervisorMaxRepeatedPrompts,
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
