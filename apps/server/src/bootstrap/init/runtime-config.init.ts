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
  sessionLockAcquireTimeoutMs: number;
  sessionEventBusPublishMaxQueuePerChat: number;
  sendMessagePolicy: SendMessagePolicy;
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
    sessionLockAcquireTimeoutMs: ENV.sessionLockAcquireTimeoutMs,
    sessionEventBusPublishMaxQueuePerChat:
      ENV.sessionEventBusPublishMaxQueuePerChat,
    sendMessagePolicy: {
      messageContentMaxBytes: ENV.messageContentMaxBytes,
      messagePartsMaxBytes: ENV.messagePartsMaxBytes,
      acpRetryMaxAttempts: ENV.acpRequestMaxAttempts,
      acpRetryBaseDelayMs: ENV.acpRequestRetryBaseDelayMs,
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
