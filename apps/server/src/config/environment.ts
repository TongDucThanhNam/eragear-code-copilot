/**
 * Environment Configuration Module
 *
 * Loads and validates environment variables using Zod schema validation.
 * Provides type-safe access to all configuration values with sensible defaults.
 *
 * @module config/environment
 */

import type { LogLevel } from "@/shared/types/log.types";
import {
  assertCompiledBootRequirements,
  type BootRuntimeMode,
  loadBootConfigValues,
  normalizeBootValue,
} from "./boot-config.loader";
import {
  DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES,
  DEFAULT_ACP_NDJSON_MAX_LINE_BYTES,
  DEFAULT_ACP_REQUEST_MAX_ATTEMPTS,
  DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_ACP_STDERR_MAX_TOTAL_BYTES,
  DEFAULT_APP_DEFAULT_MODEL,
  DEFAULT_APP_LOG_LEVEL,
  DEFAULT_APP_MAX_TOKENS,
  DEFAULT_AUTH_BOOTSTRAP_CACHE_MAX_USERS,
  DEFAULT_AUTH_BOOTSTRAP_ENSURE_DEFAULTS_TTL_MS,
  DEFAULT_AUTH_BOOTSTRAP_INFLIGHT_MAX_USERS,
  DEFAULT_BACKGROUND_CACHE_PRUNE_INTERVAL_MS,
  DEFAULT_BACKGROUND_SESSION_CLEANUP_INTERVAL_MS,
  DEFAULT_BACKGROUND_STORAGE_MAINTENANCE_INTERVAL_MS,
  DEFAULT_BACKGROUND_TASK_TIMEOUT_MS,
  DEFAULT_BACKGROUND_TICK_MS,
  DEFAULT_DEV_ALLOWED_AGENT_COMMANDS,
  DEFAULT_DEV_ALLOWED_ENV_KEYS,
  DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS,
  DEFAULT_LOG_BUFFER_LIMIT,
  DEFAULT_LOG_FLUSH_INTERVAL_MS,
  DEFAULT_MESSAGE_CONTENT_MAX_BYTES,
  DEFAULT_MESSAGE_PARTS_MAX_BYTES,
  DEFAULT_SESSION_BUFFER_LIMIT,
  DEFAULT_SESSION_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT,
  DEFAULT_SESSION_EVENT_BUS_PUBLISH_TIMEOUT_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
  DEFAULT_SESSION_LOCK_ACQUIRE_TIMEOUT_MS,
  DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
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
  DEFAULT_TERMINAL_OUTPUT_HARD_CAP_BYTES,
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WS_HOST,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DEFAULT_WS_PORT,
  HARD_MAX_APP_MAX_TOKENS,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
  HARD_MAX_STORAGE_MAX_BIND_PARAMS,
  HARD_MAX_STORAGE_RETENTION_COMPACTION_BATCH_SIZE,
} from "./constants";
import {
  firstNonEmpty,
  parseAllowlistWithFallback,
  parseCommandPoliciesWithLegacyFallback,
  parseRequiredAllowlist,
  parseRequiredCommandPolicies,
  toBoolean,
  toBoundedPositiveInt,
  toList,
  toLogLevel,
  toOptionalNumber,
  toPortNumber,
  toPositiveInt,
  toTrimmedString,
} from "./environment.parsers";
import { type EnvKey, envSchema } from "./environment.schema";

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
const authBaseUrl =
  env.AUTH_BASE_URL ?? `http://${normalizedAuthHost}:${wsPort}`;
const allowInsecureDevDefaults = toBoolean(
  env.ALLOW_INSECURE_DEV_DEFAULTS,
  false
);
if (allowInsecureDevDefaults && isProd) {
  throw new Error(
    "[Config] ALLOW_INSECURE_DEV_DEFAULTS must be false in production runtime."
  );
}
const strictAllowlistRequested = toBoolean(env.CONFIG_STRICT_ALLOWLIST, true);
if (!(strictAllowlistRequested || allowInsecureDevDefaults)) {
  throw new Error(
    "[Config] CONFIG_STRICT_ALLOWLIST=false requires ALLOW_INSECURE_DEV_DEFAULTS=true (development-only)."
  );
}
const strictAllowlist =
  bootConfig.mode === "compiled" ? true : !allowInsecureDevDefaults;
const allowlistErrors: string[] = [];
const allowlistWarnings: string[] = [];
const allowedAgentCommandPolicies = strictAllowlist
  ? parseRequiredCommandPolicies(
      "ALLOWED_AGENT_COMMAND_POLICIES",
      env.ALLOWED_AGENT_COMMAND_POLICIES,
      allowlistErrors
    )
  : parseCommandPoliciesWithLegacyFallback({
      policyName: "ALLOWED_AGENT_COMMAND_POLICIES",
      policyValue: env.ALLOWED_AGENT_COMMAND_POLICIES,
      legacyName: "ALLOWED_AGENT_COMMANDS",
      legacyValue: env.ALLOWED_AGENT_COMMANDS,
      legacyFallback: DEFAULT_DEV_ALLOWED_AGENT_COMMANDS,
      warnings: allowlistWarnings,
    });
const allowedTerminalCommandPolicies = strictAllowlist
  ? parseRequiredCommandPolicies(
      "ALLOWED_TERMINAL_COMMAND_POLICIES",
      env.ALLOWED_TERMINAL_COMMAND_POLICIES,
      allowlistErrors
    )
  : parseCommandPoliciesWithLegacyFallback({
      policyName: "ALLOWED_TERMINAL_COMMAND_POLICIES",
      policyValue: env.ALLOWED_TERMINAL_COMMAND_POLICIES,
      legacyName: "ALLOWED_TERMINAL_COMMANDS",
      legacyValue: env.ALLOWED_TERMINAL_COMMANDS,
      legacyFallback: DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS,
      warnings: allowlistWarnings,
    });
const allowedAgentCommands = [
  ...new Set(allowedAgentCommandPolicies.map((policy) => policy.command)),
];
const allowedTerminalCommands = [
  ...new Set(allowedTerminalCommandPolicies.map((policy) => policy.command)),
];
const allowedEnvKeys = strictAllowlist
  ? parseRequiredAllowlist(
      "ALLOWED_ENV_KEYS",
      env.ALLOWED_ENV_KEYS,
      allowlistErrors
    )
  : parseAllowlistWithFallback(
      "ALLOWED_ENV_KEYS",
      env.ALLOWED_ENV_KEYS,
      DEFAULT_DEV_ALLOWED_ENV_KEYS,
      allowlistWarnings
    );
if (strictAllowlist && allowlistErrors.length > 0) {
  const bootConfigHint = bootConfig.sourcePath
    ? `Loaded boot config from: ${bootConfig.sourcePath}`
    : `No settings.json boot config found. Searched: ${bootConfig.searchedPaths.join(", ")}`;
  const configInputHint =
    bootConfig.mode === "compiled"
      ? 'Compiled mode ignores env var overrides. Configure these in settings.json under "boot".'
      : "You can configure these via env vars or settings.json (boot.ALLOWED_*).";
  throw new Error(
    [
      "[Config] Invalid required allowlist configuration:",
      ...allowlistErrors.map((error) => `- ${error}`),
      'Policy format: ALLOWED_*_COMMAND_POLICIES=\'[{"command":"/usr/local/bin/codex","allowAnyArgs":true}]\'',
      "Legacy format (non-strict only): ALLOWED_*_COMMANDS=item1,item2,item3",
      configInputHint,
      bootConfigHint,
    ].join("\n")
  );
}
if (!strictAllowlist && allowlistWarnings.length > 0) {
  for (const warning of allowlistWarnings) {
    console.warn(`[Config] ${warning}`);
  }
}
const authTrustedOrigins = toList(env.AUTH_TRUSTED_ORIGINS);
const authTrustedProxyIps = toList(env.AUTH_TRUSTED_PROXY_IPS);
if (authTrustedOrigins[0] !== "*") {
  const defaultDevOrigins = [
    `http://localhost:${wsPort}`,
    `http://127.0.0.1:${wsPort}`,
    `http://0.0.0.0:${wsPort}`,
    "http://localhost:5173",
    "http://localhost:4173",
  ];
  for (const origin of defaultDevOrigins) {
    if (!authTrustedOrigins.includes(origin)) {
      authTrustedOrigins.push(origin);
    }
  }
  if (!authTrustedOrigins.includes(authBaseUrl)) {
    authTrustedOrigins.unshift(authBaseUrl);
  }
}

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
  /** Maximum number of messages to buffer per session */
  sessionBufferLimit: toPositiveInt(
    env.SESSION_BUFFER_LIMIT,
    DEFAULT_SESSION_BUFFER_LIMIT
  ),
  /** Timeout while waiting to acquire per-chat session lock */
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
  /** Enforce strict CORS origin allowlist; false means permissive dev mode */
  corsStrictOrigin: toBoolean(env.CORS_STRICT_ORIGIN, isProd),
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
};
