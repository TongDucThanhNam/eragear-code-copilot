/**
 * Environment Configuration Module
 *
 * Loads and validates environment variables using Zod schema validation.
 * Provides type-safe access to all configuration values with sensible defaults.
 *
 * @module config/environment
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import type { LogLevel, LogOutputFormat } from "@/shared/types/log.types";
import {
  assertCompiledBootRequirements,
  type BootRuntimeMode,
  loadBootConfigValues,
  normalizeBootValue,
} from "./boot-config.loader";
import {
  DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES,
  DEFAULT_ACP_NDJSON_MAX_LINE_BYTES,
  DEFAULT_ACP_PERMISSION_REQUEST_TIMEOUT_MS,
  DEFAULT_ACP_REQUEST_MAX_ATTEMPTS,
  DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_ACP_STDERR_MAX_TOTAL_BYTES,
  DEFAULT_APP_DEFAULT_MODEL,
  DEFAULT_APP_LOG_LEVEL,
  DEFAULT_APP_MAX_TOKENS,
  DEFAULT_AUTH_BOOTSTRAP_CACHE_MAX_USERS,
  DEFAULT_AUTH_BOOTSTRAP_ENSURE_DEFAULTS_TTL_MS,
  DEFAULT_AUTH_BOOTSTRAP_INFLIGHT_MAX_USERS,
  DEFAULT_AUTH_REQUIRE_CLOUDFLARE_ACCESS,
  DEFAULT_BACKGROUND_CACHE_PRUNE_INTERVAL_MS,
  DEFAULT_BACKGROUND_SESSION_CLEANUP_INTERVAL_MS,
  DEFAULT_BACKGROUND_STORAGE_MAINTENANCE_INTERVAL_MS,
  DEFAULT_BACKGROUND_TASK_TIMEOUT_MS,
  DEFAULT_BACKGROUND_TICK_MS,
  DEFAULT_EDITOR_BUFFER_MAX_FILES_PER_SESSION,
  DEFAULT_EDITOR_BUFFER_TTL_MS,
  DEFAULT_HTTP_MAX_BODY_BYTES,
  DEFAULT_LOG_BUFFER_LIMIT,
  DEFAULT_LOG_FLUSH_INTERVAL_MS,
  DEFAULT_MESSAGE_CONTENT_MAX_BYTES,
  DEFAULT_MESSAGE_PARTS_MAX_BYTES,
  DEFAULT_PROMPT_NO_SUBSCRIBER_ABORT_GRACE_MS,
  DEFAULT_SESSION_BUFFER_LIMIT,
  DEFAULT_SESSION_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT,
  DEFAULT_SESSION_EVENT_BUS_PUBLISH_TIMEOUT_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
  DEFAULT_SESSION_LOCK_ACQUIRE_TIMEOUT_MS,
  DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
  DEFAULT_SESSION_UI_MESSAGE_LIMIT,
  DEFAULT_SQLITE_WRITE_QUEUE_MAX_PENDING,
  DEFAULT_STORAGE_ALLOW_UNKNOWN_FS,
  DEFAULT_STORAGE_BUSY_MAX_RETRIES,
  DEFAULT_STORAGE_BUSY_RETRY_BASE_DELAY_MS,
  DEFAULT_STORAGE_BUSY_TIMEOUT_MS,
  DEFAULT_STORAGE_INCREMENTAL_VACUUM_MIN_FREE_PAGES,
  DEFAULT_STORAGE_INCREMENTAL_VACUUM_STEP_PAGES,
  DEFAULT_STORAGE_INIT_RETRY_COOLDOWN_MS,
  DEFAULT_STORAGE_MAX_BIND_PARAMS,
  DEFAULT_STORAGE_MAX_DB_SIZE_MB,
  DEFAULT_STORAGE_RETENTION_COMPACTION_BATCH_SIZE,
  DEFAULT_STORAGE_RETENTION_HOT_DAYS,
  DEFAULT_STORAGE_WAL_CHECKPOINT_INTERVAL_MS,
  DEFAULT_STORAGE_WORKER_ENABLED,
  DEFAULT_STORAGE_WORKER_REQUEST_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_DECISION_MAX_ATTEMPTS,
  DEFAULT_SUPERVISOR_DECISION_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_ENABLED,
  DEFAULT_SUPERVISOR_MAX_REPEATED_PROMPTS,
  DEFAULT_SUPERVISOR_MAX_RUNTIME_MS,
  DEFAULT_SUPERVISOR_MEMORY_PROVIDER,
  DEFAULT_SUPERVISOR_MODEL,
  DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND,
  DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_LIMIT,
  DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH,
  DEFAULT_SUPERVISOR_OBSIDIAN_TIMEOUT_MS,
  DEFAULT_SUPERVISOR_WEB_SEARCH_PROVIDER,
  DEFAULT_TERMINAL_OUTPUT_HARD_CAP_BYTES,
  DEFAULT_WS_AUTH_TIMEOUT_MS,
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WS_HOST,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DEFAULT_WS_PORT,
  DEFAULT_WS_SESSION_REVALIDATE_INTERVAL_MS,
  HARD_MAX_APP_MAX_TOKENS,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
  HARD_MAX_STORAGE_MAX_BIND_PARAMS,
  HARD_MAX_STORAGE_RETENTION_COMPACTION_BATCH_SIZE,
} from "./constants";
import { resolveAllowlistConfig } from "./environment.allowlist";
import { resolveAuthTrustedOrigins } from "./environment.auth";
import {
  firstNonEmpty,
  toBoolean,
  toBoundedPositiveInt,
  toList,
  toLogLevel,
  toLogOutputFormat,
  toOptionalNumber,
  toPortNumber,
  toPositiveInt,
  toStrictBoolean,
  toTrimmedString,
} from "./environment.parsers";
import { type EnvKey, envSchema } from "./environment.schema";

loadServerDotEnv();

export type AcpTurnIdPolicy = "compat" | "require-native";
export type SupervisorWebSearchProvider = "none" | "exa";
export type SupervisorMemoryProvider = "none" | "obsidian";

function loadServerDotEnv(): void {
  const appEnvPath = fileURLToPath(new URL("../../.env", import.meta.url));
  const cwdEnvPath = resolve(process.cwd(), ".env");
  const envPaths = [...new Set([appEnvPath, cwdEnvPath])].filter((path) =>
    existsSync(path)
  );

  for (const path of envPaths) {
    loadDotEnv({ path, override: false, quiet: true });
  }
}

function assertBunRuntime(): void {
  const bunVersion = process.versions?.bun;
  if (typeof bunVersion === "string" && bunVersion.length > 0) {
    return;
  }
  throw new Error(
    "[Config] Bun runtime is required. Node.js runtime is not supported."
  );
}

function createEnvInput(
  bootConfigValues: Record<string, unknown>,
  mode: BootRuntimeMode
): Record<EnvKey, string | undefined> {
  const keys = Object.keys(envSchema.shape) as EnvKey[];
  const out = {} as Record<EnvKey, string | undefined>;

  for (const key of keys) {
    const bootValue = normalizeBootValue(bootConfigValues[key]);
    if (mode === "compiled") {
      out[key] = bootValue;
      continue;
    }
    const envValue = process.env[key];
    if (envValue && envValue.trim().length > 0) {
      out[key] = envValue;
      continue;
    }
    out[key] = bootValue;
  }

  return out;
}

function resolveAcpTurnIdPolicy(value: string | undefined): AcpTurnIdPolicy {
  const normalized = toTrimmedString(value, "compat").toLowerCase();
  if (normalized === "compat") {
    return "compat";
  }
  if (normalized === "require-native" || normalized === "require_native") {
    return "require-native";
  }
  throw new Error(
    "[Config] ACP_TURN_ID_POLICY must be one of: compat, require-native."
  );
}

function resolveSupervisorWebSearchProvider(
  value: string | undefined
): SupervisorWebSearchProvider {
  const normalized = toTrimmedString(
    value,
    DEFAULT_SUPERVISOR_WEB_SEARCH_PROVIDER
  )
    .toLowerCase()
    .trim();
  if (normalized === "none" || normalized === "exa") {
    return normalized;
  }
  throw new Error(
    "[Config] SUPERVISOR_WEB_SEARCH_PROVIDER must be one of: none, exa."
  );
}

function resolveSupervisorMemoryProvider(
  value: string | undefined
): SupervisorMemoryProvider {
  const normalized = toTrimmedString(value, DEFAULT_SUPERVISOR_MEMORY_PROVIDER)
    .toLowerCase()
    .trim();
  if (normalized === "none" || normalized === "obsidian") {
    return normalized;
  }
  throw new Error(
    "[Config] SUPERVISOR_MEMORY_PROVIDER must be one of: none, obsidian."
  );
}

const bootConfig = loadBootConfigValues();
assertBunRuntime();

if (bootConfig.mode === "compiled") {
  assertCompiledBootRequirements(bootConfig);
}

/** Parse environment variables */
const env = envSchema.parse(createEnvInput(bootConfig.values, bootConfig.mode));

const wsPort = toPortNumber(
  firstNonEmpty([env.WS_PORT, env.PORT]),
  DEFAULT_WS_PORT
);
const wsHost = firstNonEmpty([env.WS_HOST, env.HOST]) ?? DEFAULT_WS_HOST;
const normalizedAuthHost = wsHost === "0.0.0.0" ? "localhost" : wsHost;
const runtimeEnv = env.NODE_ENV ?? env.BUN_ENV ?? "production";
const isProd = runtimeEnv === "production";
const isDev = !isProd;
const runtimeNodeRoleRaw = toTrimmedString(env.RUNTIME_NODE_ROLE, "writer")
  .toLowerCase()
  .trim();
const runtimeNodeRole: "writer" | "reader" =
  runtimeNodeRoleRaw === "reader" ? "reader" : "writer";
const acpFsWriteEnabled = toBoolean(env.ACP_ENABLE_FS_WRITE, false);
const acpTerminalEnabled = toBoolean(env.ACP_ENABLE_TERMINAL, false);
const runtimeWriterUrl = toTrimmedString(env.RUNTIME_WRITER_URL, "");
if (runtimeNodeRole === "reader" && runtimeWriterUrl.length === 0) {
  throw new Error(
    "[Config] RUNTIME_WRITER_URL is required when RUNTIME_NODE_ROLE=reader."
  );
}
const runtimeInternalToken = toTrimmedString(env.RUNTIME_INTERNAL_TOKEN, "");
if (runtimeNodeRole === "reader" && runtimeInternalToken.length === 0) {
  throw new Error(
    "[Config] RUNTIME_INTERNAL_TOKEN is required when RUNTIME_NODE_ROLE=reader."
  );
}
const sqliteWorkerEnabled = toBoolean(
  env.STORAGE_WORKER_ENABLED,
  DEFAULT_STORAGE_WORKER_ENABLED
);
if (isProd && !sqliteWorkerEnabled) {
  throw new Error(
    "[Config] STORAGE_WORKER_ENABLED must be true in production runtime."
  );
}
const defaultApiKeyRateLimitWindowMs = 60_000;
const defaultApiKeyRateLimitMaxRequests = 3000;
const acpTurnIdPolicy = resolveAcpTurnIdPolicy(env.ACP_TURN_ID_POLICY);
const supervisorWebSearchProvider = resolveSupervisorWebSearchProvider(
  env.SUPERVISOR_WEB_SEARCH_PROVIDER
);
const supervisorMemoryProvider = resolveSupervisorMemoryProvider(
  env.SUPERVISOR_MEMORY_PROVIDER
);
const supervisorWebSearchApiKey = toTrimmedString(
  firstNonEmpty([env.SUPERVISOR_WEB_SEARCH_API_KEY, env.EXA_API_KEY]),
  ""
);
if (
  supervisorWebSearchProvider === "exa" &&
  supervisorWebSearchApiKey.length === 0
) {
  throw new Error(
    "[Config] SUPERVISOR_WEB_SEARCH_API_KEY or EXA_API_KEY is required when SUPERVISOR_WEB_SEARCH_PROVIDER=exa."
  );
}
const authBaseUrl =
  env.AUTH_BASE_URL ?? `http://${normalizedAuthHost}:${wsPort}`;
const allowlistConfig = resolveAllowlistConfig({
  bootMode: bootConfig.mode,
  isProd,
  allowInsecureDevDefaultsRaw: env.ALLOW_INSECURE_DEV_DEFAULTS,
  strictAllowlistRaw: env.CONFIG_STRICT_ALLOWLIST,
  allowedAgentCommandPoliciesRaw: env.ALLOWED_AGENT_COMMAND_POLICIES,
  allowedAgentCommandsRaw: env.ALLOWED_AGENT_COMMANDS,
  allowedTerminalCommandPoliciesRaw: env.ALLOWED_TERMINAL_COMMAND_POLICIES,
  allowedTerminalCommandsRaw: env.ALLOWED_TERMINAL_COMMANDS,
  allowedEnvKeysRaw: env.ALLOWED_ENV_KEYS,
  bootSourcePath: bootConfig.sourcePath,
  bootSearchedPaths: bootConfig.searchedPaths,
});
const allowInsecureDevDefaults = allowlistConfig.allowInsecureDevDefaults;
const strictAllowlist = allowlistConfig.strictAllowlist;
const allowedAgentCommandPolicies = allowlistConfig.allowedAgentCommandPolicies;
const allowedTerminalCommandPolicies =
  allowlistConfig.allowedTerminalCommandPolicies;
const allowedAgentCommands = allowlistConfig.allowedAgentCommands;
const allowedTerminalCommands = allowlistConfig.allowedTerminalCommands;
const allowedEnvKeys = allowlistConfig.allowedEnvKeys;
const authTrustedOrigins = resolveAuthTrustedOrigins({
  configuredOrigins: toList(env.AUTH_TRUSTED_ORIGINS),
  authBaseUrl,
  wsPort,
});
const authTrustedProxyIps = toList(env.AUTH_TRUSTED_PROXY_IPS);
const authRequireCloudflareAccess = toBoolean(
  env.AUTH_REQUIRE_CLOUDFLARE_ACCESS,
  DEFAULT_AUTH_REQUIRE_CLOUDFLARE_ACCESS
);
const cloudflareAccessClientId = toTrimmedString(
  env.AUTH_CLOUDFLARE_ACCESS_CLIENT_ID,
  ""
);
const cloudflareAccessClientSecret = toTrimmedString(
  env.AUTH_CLOUDFLARE_ACCESS_CLIENT_SECRET,
  ""
);
const cloudflareAccessJwtPublicKeyPem = toTrimmedString(
  env.AUTH_CLOUDFLARE_ACCESS_JWT_PUBLIC_KEY_PEM,
  ""
).replace(/\\n/g, "\n");
const cloudflareAccessJwtAudience = toTrimmedString(
  env.AUTH_CLOUDFLARE_ACCESS_JWT_AUDIENCE,
  ""
);
const cloudflareAccessJwtIssuer = toTrimmedString(
  env.AUTH_CLOUDFLARE_ACCESS_JWT_ISSUER,
  ""
);
const hasCloudflareServiceTokenConfig =
  cloudflareAccessClientId.length > 0 &&
  cloudflareAccessClientSecret.length > 0;
const hasCloudflareJwtConfig =
  cloudflareAccessJwtPublicKeyPem.length > 0 &&
  cloudflareAccessJwtAudience.length > 0 &&
  cloudflareAccessJwtIssuer.length > 0;
if (
  (cloudflareAccessClientId.length > 0 ||
    cloudflareAccessClientSecret.length > 0) &&
  !hasCloudflareServiceTokenConfig
) {
  throw new Error(
    "[Config] AUTH_CLOUDFLARE_ACCESS_CLIENT_ID and AUTH_CLOUDFLARE_ACCESS_CLIENT_SECRET must both be set together."
  );
}
if (
  (cloudflareAccessJwtPublicKeyPem.length > 0 ||
    cloudflareAccessJwtAudience.length > 0 ||
    cloudflareAccessJwtIssuer.length > 0) &&
  !hasCloudflareJwtConfig
) {
  throw new Error(
    "[Config] AUTH_CLOUDFLARE_ACCESS_JWT_PUBLIC_KEY_PEM, AUTH_CLOUDFLARE_ACCESS_JWT_AUDIENCE, and AUTH_CLOUDFLARE_ACCESS_JWT_ISSUER must all be set together."
  );
}
if (
  authRequireCloudflareAccess &&
  !hasCloudflareServiceTokenConfig &&
  !hasCloudflareJwtConfig
) {
  throw new Error(
    "[Config] AUTH_REQUIRE_CLOUDFLARE_ACCESS=true requires either service-token credentials or JWT verification configuration."
  );
}
const corsStrictOrigin = toStrictBoolean(
  env.CORS_STRICT_ORIGIN,
  true,
  "CORS_STRICT_ORIGIN"
);
if (isProd && !corsStrictOrigin) {
  throw new Error(
    "[Config] CORS_STRICT_ORIGIN must be true in production runtime."
  );
}
const defaultLogOutputFormat: LogOutputFormat = isProd ? "json" : "text";

/**
 * Application configuration loaded from environment variables
 * All values have sensible defaults
 */
export const ENV = {
  /** Boot configuration mode controlling env override behavior */
  bootMode: bootConfig.mode,
  /** True when running in strict compiled configuration mode */
  isCompiledConfigMode: bootConfig.mode === "compiled",
  /** Runtime environment */
  runtimeEnv,
  /** Runtime node role for single-writer topologies */
  runtimeNodeRole,
  /** Optional writer base URL used by reader nodes */
  runtimeWriterUrl: runtimeWriterUrl.length > 0 ? runtimeWriterUrl : undefined,
  /** Optional bearer token used for internal runtime forwarding */
  runtimeInternalToken:
    runtimeInternalToken.length > 0 ? runtimeInternalToken : undefined,
  /** Strict enforcement mode for required ALLOWED_* allowlists */
  strictAllowlist,
  /** Explicit development-only override for insecure allowlist defaults */
  allowInsecureDevDefaults,
  /** True when running in development or test modes */
  isDev,
  /** True when running in production mode */
  isProd,
  /** Timeout for idle sessions in milliseconds */
  sessionIdleTimeoutMs: toPositiveInt(
    env.SESSION_IDLE_TIMEOUT_MS,
    DEFAULT_SESSION_IDLE_TIMEOUT_MS
  ),
  /** Grace period before aborting a live prompt after the last subscriber disconnects */
  promptNoSubscriberAbortGraceMs: toPositiveInt(
    env.PROMPT_NO_SUBSCRIBER_ABORT_GRACE_MS,
    DEFAULT_PROMPT_NO_SUBSCRIBER_ABORT_GRACE_MS
  ),
  /** Maximum number of messages to buffer per session */
  sessionBufferLimit: toPositiveInt(
    env.SESSION_BUFFER_LIMIT,
    DEFAULT_SESSION_BUFFER_LIMIT
  ),
  /** Maximum number of UI messages retained in active runtime memory */
  sessionUiMessageLimit: toPositiveInt(
    env.SESSION_UI_MESSAGE_LIMIT,
    DEFAULT_SESSION_UI_MESSAGE_LIMIT
  ),
  /** Warning threshold for per-chat session lock acquisition latency */
  sessionLockAcquireTimeoutMs: toPositiveInt(
    env.SESSION_LOCK_ACQUIRE_TIMEOUT_MS,
    DEFAULT_SESSION_LOCK_ACQUIRE_TIMEOUT_MS
  ),
  /** Timeout budget for one event bus publish from session runtime */
  sessionEventBusPublishTimeoutMs: toPositiveInt(
    env.SESSION_EVENT_BUS_PUBLISH_TIMEOUT_MS,
    DEFAULT_SESSION_EVENT_BUS_PUBLISH_TIMEOUT_MS
  ),
  /** Maximum queued event bus publish jobs per chat */
  sessionEventBusPublishMaxQueuePerChat: toPositiveInt(
    env.SESSION_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT,
    DEFAULT_SESSION_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT
  ),
  /** WebSocket heartbeat interval in milliseconds */
  wsHeartbeatIntervalMs: toPositiveInt(
    env.WS_HEARTBEAT_INTERVAL_MS,
    DEFAULT_WS_HEARTBEAT_INTERVAL_MS
  ),
  /** Maximum accepted payload per WebSocket message/frame in bytes */
  wsMaxPayloadBytes: toPositiveInt(
    env.WS_MAX_PAYLOAD_BYTES,
    DEFAULT_WS_MAX_PAYLOAD_BYTES
  ),
  /** Timeout for unauthenticated WebSocket connections in milliseconds */
  wsAuthTimeoutMs: toPositiveInt(
    env.WS_AUTH_TIMEOUT_MS,
    DEFAULT_WS_AUTH_TIMEOUT_MS
  ),
  /** Interval for periodic WebSocket session re-validation in milliseconds */
  wsSessionRevalidateIntervalMs: toPositiveInt(
    env.WS_SESSION_REVALIDATE_INTERVAL_MS,
    DEFAULT_WS_SESSION_REVALIDATE_INTERVAL_MS
  ),
  /** Maximum accepted HTTP request body size for JSON API endpoints */
  httpMaxBodyBytes: toPositiveInt(
    env.HTTP_MAX_BODY_BYTES,
    DEFAULT_HTTP_MAX_BODY_BYTES
  ),
  /** WebSocket server port */
  wsPort,
  /** WebSocket server host */
  wsHost,
  /** Optional maximum agent runtime duration in milliseconds */
  agentTimeoutMs: toOptionalNumber(env.AGENT_TIMEOUT_MS),
  /** Optional maximum terminal runtime duration in milliseconds */
  terminalTimeoutMs: toOptionalNumber(env.TERMINAL_TIMEOUT_MS),
  /** Hard cap for retained terminal output bytes */
  terminalOutputHardCapBytes: toPositiveInt(
    env.TERMINAL_OUTPUT_HARD_CAP_BYTES,
    DEFAULT_TERMINAL_OUTPUT_HARD_CAP_BYTES
  ),
  /** Whether ACP agents may write files through client-exposed fs methods */
  acpFsWriteEnabled,
  /** Whether ACP agents may create terminal subprocesses through client-exposed terminal methods */
  acpTerminalEnabled,
  /** Migration policy controlling whether live ACP turn-scoped ingress must carry a native turnId */
  acpTurnIdPolicy,
  /** Structured policy map for agent command invocations */
  allowedAgentCommandPolicies,
  /** Structured policy map for terminal command invocations */
  allowedTerminalCommandPolicies,
  /** Required allowlist of agent commands */
  allowedAgentCommands,
  /** Required allowlist of terminal commands */
  allowedTerminalCommands,
  /** Required allowlist of environment variable keys */
  allowedEnvKeys,
  /** Runtime-configurable max page size for session list endpoints */
  sessionListPageMaxLimit: toBoundedPositiveInt(
    env.SESSION_LIST_PAGE_MAX_LIMIT,
    DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
    1,
    HARD_MAX_SESSION_LIST_PAGE_LIMIT
  ),
  /** Runtime-configurable max page size for session messages endpoints */
  sessionMessagesPageMaxLimit: toBoundedPositiveInt(
    env.SESSION_MESSAGES_PAGE_MAX_LIMIT,
    DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
    1,
    HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT
  ),
  /** Better Auth secret (persisted or env) */
  authSecret: env.AUTH_SECRET,
  /** Better Auth base URL */
  authBaseUrl,
  /** Better Auth trusted origins */
  authTrustedOrigins,
  /** Trusted reverse-proxy source IPs allowed to provide forwarded client IP headers */
  authTrustedProxyIps,
  /** Require Cloudflare Access auth headers for WS/tRPC handshake */
  authRequireCloudflareAccess,
  /** Expected Cloudflare Access service token client ID for WS handshake auth */
  authCloudflareAccessClientId:
    cloudflareAccessClientId.length > 0 ? cloudflareAccessClientId : undefined,
  /** Expected Cloudflare Access service token client secret for WS handshake auth */
  authCloudflareAccessClientSecret:
    cloudflareAccessClientSecret.length > 0
      ? cloudflareAccessClientSecret
      : undefined,
  /** Optional PEM public key for validating Cloudflare Access JWT assertions */
  authCloudflareAccessJwtPublicKeyPem:
    cloudflareAccessJwtPublicKeyPem.length > 0
      ? cloudflareAccessJwtPublicKeyPem
      : undefined,
  /** Required JWT audience when Cloudflare Access JWT verification is enabled */
  authCloudflareAccessJwtAudience:
    cloudflareAccessJwtAudience.length > 0
      ? cloudflareAccessJwtAudience
      : undefined,
  /** Required JWT issuer when Cloudflare Access JWT verification is enabled */
  authCloudflareAccessJwtIssuer:
    cloudflareAccessJwtIssuer.length > 0
      ? cloudflareAccessJwtIssuer
      : undefined,
  /** Enforce strict CORS origin allowlist across environments */
  corsStrictOrigin,
  /** Optional admin bootstrap username */
  authAdminUsername: env.AUTH_ADMIN_USERNAME,
  /** Optional admin bootstrap password */
  authAdminPassword: env.AUTH_ADMIN_PASSWORD,
  /** Optional admin bootstrap email */
  authAdminEmail: env.AUTH_ADMIN_EMAIL,
  /** Allow public sign-up via HTTP endpoints */
  authAllowSignup: toBoolean(env.AUTH_ALLOW_SIGNUP, false),
  /** Optional auth database path override */
  authDbPath: env.AUTH_DB_PATH,
  /** Bootstrap a default API key if none exist */
  authBootstrapApiKey: toBoolean(env.AUTH_BOOTSTRAP_API_KEY, true),
  /** TTL for ensure-defaults bootstrap dedupe cache per authenticated user */
  authBootstrapEnsureDefaultsTtlMs: toPositiveInt(
    env.AUTH_BOOTSTRAP_ENSURE_DEFAULTS_TTL_MS,
    DEFAULT_AUTH_BOOTSTRAP_ENSURE_DEFAULTS_TTL_MS
  ),
  /** Max retained users in auth bootstrap ensure-defaults success cache */
  authBootstrapCacheMaxUsers: toPositiveInt(
    env.AUTH_BOOTSTRAP_CACHE_MAX_USERS,
    DEFAULT_AUTH_BOOTSTRAP_CACHE_MAX_USERS
  ),
  /** Max tracked in-flight ensure-defaults tasks for auth bootstrap */
  authBootstrapInFlightMaxUsers: toPositiveInt(
    env.AUTH_BOOTSTRAP_INFLIGHT_MAX_USERS,
    DEFAULT_AUTH_BOOTSTRAP_INFLIGHT_MAX_USERS
  ),
  /** Default API key prefix */
  authApiKeyPrefix: env.AUTH_API_KEY_PREFIX,
  /** Enable API key plugin rate limiting */
  authApiKeyRateLimitEnabled: toBoolean(
    env.AUTH_API_KEY_RATE_LIMIT_ENABLED,
    true
  ),
  /** API key rate limit window in milliseconds */
  authApiKeyRateLimitTimeWindowMs:
    toOptionalNumber(env.AUTH_API_KEY_RATE_LIMIT_TIME_WINDOW_MS) ??
    defaultApiKeyRateLimitWindowMs,
  /** Maximum requests allowed per API key within the rate limit window */
  authApiKeyRateLimitMaxRequests:
    toOptionalNumber(env.AUTH_API_KEY_RATE_LIMIT_MAX_REQUESTS) ??
    defaultApiKeyRateLimitMaxRequests,
  /** Log buffer max entries */
  logBufferLimit: toPositiveInt(env.LOG_BUFFER_LIMIT, DEFAULT_LOG_BUFFER_LIMIT),
  /** Global minimum log level for emitted server logs */
  logLevel: toLogLevel(env.LOG_LEVEL, DEFAULT_APP_LOG_LEVEL as LogLevel),
  /** Structured logger output format */
  logOutputFormat: toLogOutputFormat(
    env.LOG_OUTPUT_FORMAT,
    defaultLogOutputFormat
  ),
  /** Log flush interval in milliseconds */
  logFlushIntervalMs: toPositiveInt(
    env.LOG_FLUSH_INTERVAL_MS,
    DEFAULT_LOG_FLUSH_INTERVAL_MS
  ),
  /** Optional log retention days (undefined to keep all) */
  logRetentionDays: toOptionalNumber(env.LOG_RETENTION_DAYS),
  /** Enable log file sink */
  logFileEnabled: toBoolean(env.LOG_FILE_ENABLED, true),
  /** Runtime max-tokens hint for prompt requests */
  maxTokens: toBoundedPositiveInt(
    env.MAX_TOKENS,
    DEFAULT_APP_MAX_TOKENS,
    1,
    HARD_MAX_APP_MAX_TOKENS
  ),
  /** Preferred default model for new sessions when available */
  defaultModel: toTrimmedString(env.DEFAULT_MODEL, DEFAULT_APP_DEFAULT_MODEL),
  /** Global kill switch for server-side ACP supervisor autopilot. */
  supervisorEnabled: toBoolean(
    env.SUPERVISOR_ENABLED,
    DEFAULT_SUPERVISOR_ENABLED
  ),
  /** AI SDK model id used for supervisor decisions. */
  supervisorModel: toTrimmedString(
    env.SUPERVISOR_MODEL,
    DEFAULT_SUPERVISOR_MODEL
  ),
  /** Optional DeepSeek key for supervisor decision models. */
  supervisorDeepSeekApiKey: toTrimmedString(env.DEEPSEEK_API_KEY, ""),
  /** Timeout for one supervisor model decision in milliseconds. */
  supervisorDecisionTimeoutMs: toPositiveInt(
    env.SUPERVISOR_DECISION_TIMEOUT_MS,
    DEFAULT_SUPERVISOR_DECISION_TIMEOUT_MS
  ),
  /** Maximum attempts for one supervisor model decision before failing closed. */
  supervisorDecisionMaxAttempts: toPositiveInt(
    env.SUPERVISOR_DECISION_MAX_ATTEMPTS,
    DEFAULT_SUPERVISOR_DECISION_MAX_ATTEMPTS
  ),
  /** Wall-clock limit for one supervisor run in milliseconds. */
  supervisorMaxRuntimeMs: toPositiveInt(
    env.SUPERVISOR_MAX_RUNTIME_MS,
    DEFAULT_SUPERVISOR_MAX_RUNTIME_MS
  ),
  /** Maximum repeated supervisor prompts in one run. */
  supervisorMaxRepeatedPrompts: toPositiveInt(
    env.SUPERVISOR_MAX_REPEATED_PROMPTS,
    DEFAULT_SUPERVISOR_MAX_REPEATED_PROMPTS
  ),
  /** Optional supervisor web-search provider. */
  supervisorWebSearchProvider,
  /** Optional Exa key for supervisor web search. */
  supervisorWebSearchApiKey:
    supervisorWebSearchApiKey.length > 0
      ? supervisorWebSearchApiKey
      : undefined,
  /** Optional supervisor local-memory provider. */
  supervisorMemoryProvider,
  /** Obsidian CLI command used by supervisor local memory. */
  supervisorObsidianCommand: toTrimmedString(
    env.SUPERVISOR_OBSIDIAN_COMMAND,
    DEFAULT_SUPERVISOR_OBSIDIAN_COMMAND
  ),
  /** Optional Obsidian vault name for supervisor local memory. */
  supervisorObsidianVault: toTrimmedString(env.SUPERVISOR_OBSIDIAN_VAULT, ""),
  /** Optional Obsidian note path containing the compact project blueprint. */
  supervisorObsidianBlueprintPath: toTrimmedString(
    env.SUPERVISOR_OBSIDIAN_BLUEPRINT_PATH,
    ""
  ),
  /** Optional Obsidian note path for supervisor audit logs. */
  supervisorObsidianLogPath: toTrimmedString(
    env.SUPERVISOR_OBSIDIAN_LOG_PATH,
    ""
  ),
  /** Obsidian folder searched for supervisor local memory. */
  supervisorObsidianSearchPath: toTrimmedString(
    env.SUPERVISOR_OBSIDIAN_SEARCH_PATH,
    DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_PATH
  ),
  /** Maximum Obsidian search results included in one supervisor decision. */
  supervisorObsidianSearchLimit: toPositiveInt(
    env.SUPERVISOR_OBSIDIAN_SEARCH_LIMIT,
    DEFAULT_SUPERVISOR_OBSIDIAN_SEARCH_LIMIT
  ),
  /** Timeout for one Obsidian CLI command in milliseconds. */
  supervisorObsidianTimeoutMs: toPositiveInt(
    env.SUPERVISOR_OBSIDIAN_TIMEOUT_MS,
    DEFAULT_SUPERVISOR_OBSIDIAN_TIMEOUT_MS
  ),
  /** Enable background runner */
  backgroundEnabled: toBoolean(env.BACKGROUND_ENABLED, true),
  /** Background runner tick interval in milliseconds */
  backgroundTickMs: toPositiveInt(
    env.BACKGROUND_TICK_MS,
    DEFAULT_BACKGROUND_TICK_MS
  ),
  /** Timeout for a single background task run in milliseconds */
  backgroundTaskTimeoutMs: toPositiveInt(
    env.BACKGROUND_TASK_TIMEOUT_MS,
    DEFAULT_BACKGROUND_TASK_TIMEOUT_MS
  ),
  /** Interval for session idle cleanup task in milliseconds */
  backgroundSessionCleanupIntervalMs: toPositiveInt(
    env.BACKGROUND_SESSION_CLEANUP_INTERVAL_MS,
    DEFAULT_BACKGROUND_SESSION_CLEANUP_INTERVAL_MS
  ),
  /** Interval for cache prune task in milliseconds */
  backgroundCachePruneIntervalMs: toPositiveInt(
    env.BACKGROUND_CACHE_PRUNE_INTERVAL_MS,
    DEFAULT_BACKGROUND_CACHE_PRUNE_INTERVAL_MS
  ),
  /** Interval for sqlite maintenance task in milliseconds */
  backgroundSqliteMaintenanceIntervalMs: toPositiveInt(
    env.BACKGROUND_STORAGE_MAINTENANCE_INTERVAL_MS,
    DEFAULT_BACKGROUND_STORAGE_MAINTENANCE_INTERVAL_MS
  ),
  /** Cooldown before retrying a failed SQLite init */
  sqliteInitRetryCooldownMs: toPositiveInt(
    env.STORAGE_INIT_RETRY_COOLDOWN_MS,
    DEFAULT_STORAGE_INIT_RETRY_COOLDOWN_MS
  ),
  /** SQLite busy timeout in milliseconds */
  sqliteBusyTimeoutMs: toPositiveInt(
    env.STORAGE_BUSY_TIMEOUT_MS,
    DEFAULT_STORAGE_BUSY_TIMEOUT_MS
  ),
  /** Maximum retries for SQLITE_BUSY operations */
  sqliteBusyMaxRetries: toPositiveInt(
    env.STORAGE_BUSY_MAX_RETRIES,
    DEFAULT_STORAGE_BUSY_MAX_RETRIES
  ),
  /** Base delay for SQLITE_BUSY retry backoff */
  sqliteBusyRetryBaseDelayMs: toPositiveInt(
    env.STORAGE_BUSY_RETRY_BASE_DELAY_MS,
    DEFAULT_STORAGE_BUSY_RETRY_BASE_DELAY_MS
  ),
  /** Maximum pending SQLite write tasks before enqueue rejection */
  sqliteWriteQueueMaxPending: toPositiveInt(
    env.SQLITE_WRITE_QUEUE_MAX_PENDING,
    DEFAULT_SQLITE_WRITE_QUEUE_MAX_PENDING
  ),
  /** Maximum SQLite bind parameters per statement */
  sqliteMaxBindParams: toBoundedPositiveInt(
    env.STORAGE_MAX_BIND_PARAMS,
    DEFAULT_STORAGE_MAX_BIND_PARAMS,
    1,
    HARD_MAX_STORAGE_MAX_BIND_PARAMS
  ),
  /** Minimum free pages before incremental vacuum kicks in */
  sqliteIncrementalVacuumMinFreePages: toPositiveInt(
    env.STORAGE_INCREMENTAL_VACUUM_MIN_FREE_PAGES,
    DEFAULT_STORAGE_INCREMENTAL_VACUUM_MIN_FREE_PAGES
  ),
  /** Maximum pages reclaimed per incremental vacuum pass */
  sqliteIncrementalVacuumStepPages: toPositiveInt(
    env.STORAGE_INCREMENTAL_VACUUM_STEP_PAGES,
    DEFAULT_STORAGE_INCREMENTAL_VACUUM_STEP_PAGES
  ),
  /** Interval between WAL checkpoints in milliseconds */
  sqliteWalCheckpointIntervalMs: toPositiveInt(
    env.STORAGE_WAL_CHECKPOINT_INTERVAL_MS,
    DEFAULT_STORAGE_WAL_CHECKPOINT_INTERVAL_MS
  ),
  /** Number of days to retain full message payload before compaction */
  sqliteRetentionHotDays: toPositiveInt(
    env.STORAGE_RETENTION_HOT_DAYS,
    DEFAULT_STORAGE_RETENTION_HOT_DAYS
  ),
  /** Maximum compacted rows per maintenance batch */
  sqliteRetentionCompactionBatchSize: toBoundedPositiveInt(
    env.STORAGE_RETENTION_COMPACTION_BATCH_SIZE,
    DEFAULT_STORAGE_RETENTION_COMPACTION_BATCH_SIZE,
    1,
    HARD_MAX_STORAGE_RETENTION_COMPACTION_BATCH_SIZE
  ),
  /** Soft alert threshold for SQLite DB size */
  sqliteMaxDbSizeMb: toPositiveInt(
    env.STORAGE_MAX_DB_SIZE_MB,
    DEFAULT_STORAGE_MAX_DB_SIZE_MB
  ),
  /** Enable SQLite worker-thread request offloading */
  sqliteWorkerEnabled,
  /** Timeout for one SQLite worker request in milliseconds */
  sqliteWorkerRequestTimeoutMs: toPositiveInt(
    env.STORAGE_WORKER_REQUEST_TIMEOUT_MS,
    DEFAULT_STORAGE_WORKER_REQUEST_TIMEOUT_MS
  ),
  /** Maximum bytes allowed for plain message content */
  messageContentMaxBytes: toPositiveInt(
    env.MESSAGE_CONTENT_MAX_BYTES,
    DEFAULT_MESSAGE_CONTENT_MAX_BYTES
  ),
  /** Maximum bytes allowed for serialized message parts JSON */
  messagePartsMaxBytes: toPositiveInt(
    env.MESSAGE_PARTS_MAX_BYTES,
    DEFAULT_MESSAGE_PARTS_MAX_BYTES
  ),
  /** Maximum age for unsaved editor buffers before eviction */
  editorBufferTtlMs: toPositiveInt(
    env.EDITOR_BUFFER_TTL_MS,
    DEFAULT_EDITOR_BUFFER_TTL_MS
  ),
  /** Maximum dirty editor files retained per session */
  editorBufferMaxFilesPerSession: toPositiveInt(
    env.EDITOR_BUFFER_MAX_FILES_PER_SESSION,
    DEFAULT_EDITOR_BUFFER_MAX_FILES_PER_SESSION
  ),
  /** Max attempts for ACP requests on transient transport-not-ready errors */
  acpRequestMaxAttempts: toPositiveInt(
    env.ACP_REQUEST_MAX_ATTEMPTS,
    DEFAULT_ACP_REQUEST_MAX_ATTEMPTS
  ),
  /** Base delay in milliseconds for ACP retry backoff */
  acpRequestRetryBaseDelayMs: toPositiveInt(
    env.ACP_REQUEST_RETRY_BASE_DELAY_MS,
    DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS
  ),
  /** Maximum time an ACP permission request may remain unresolved */
  acpPermissionRequestTimeoutMs: toPositiveInt(
    env.ACP_PERMISSION_REQUEST_TIMEOUT_MS,
    DEFAULT_ACP_PERMISSION_REQUEST_TIMEOUT_MS
  ),
  /** Maximum accepted NDJSON line size from ACP stdout */
  acpNdjsonMaxLineBytes: toPositiveInt(
    env.ACP_NDJSON_MAX_LINE_BYTES,
    DEFAULT_ACP_NDJSON_MAX_LINE_BYTES
  ),
  /** Maximum buffered NDJSON payload bytes before fail-fast termination */
  acpNdjsonMaxBufferedBytes: toPositiveInt(
    env.ACP_NDJSON_MAX_BUFFERED_BYTES,
    DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES
  ),
  /** Maximum cumulative stderr bytes from one ACP process before termination */
  acpStderrMaxTotalBytes: toPositiveInt(
    env.ACP_STDERR_MAX_TOTAL_BYTES,
    DEFAULT_ACP_STDERR_MAX_TOTAL_BYTES
  ),
  /** Optional override path for SQLite drizzle migrations directory */
  sqliteMigrationsDir: env.STORAGE_MIGRATIONS_DIR?.trim() || undefined,
  /** Allow storage path guard to accept unknown filesystem types */
  storageAllowUnknownFs: toBoolean(
    env.STORAGE_ALLOW_UNKNOWN_FS,
    DEFAULT_STORAGE_ALLOW_UNKNOWN_FS
  ),
};
