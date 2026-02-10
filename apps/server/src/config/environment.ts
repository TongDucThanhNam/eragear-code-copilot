/**
 * Environment Configuration Module
 *
 * Loads and validates environment variables using Zod schema validation.
 * Provides type-safe access to all configuration values with sensible defaults.
 *
 * @module config/environment
 */

import { z } from "zod";
import {
  DEFAULT_ACP_REQUEST_MAX_ATTEMPTS,
  DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_BACKGROUND_CACHE_PRUNE_INTERVAL_MS,
  DEFAULT_BACKGROUND_SESSION_CLEANUP_INTERVAL_MS,
  DEFAULT_BACKGROUND_SQLITE_MAINTENANCE_INTERVAL_MS,
  DEFAULT_BACKGROUND_TASK_TIMEOUT_MS,
  DEFAULT_BACKGROUND_TICK_MS,
  DEFAULT_LOG_BUFFER_LIMIT,
  DEFAULT_LOG_FLUSH_INTERVAL_MS,
  DEFAULT_MESSAGE_CONTENT_MAX_BYTES,
  DEFAULT_MESSAGE_PARTS_MAX_BYTES,
  DEFAULT_SESSION_BUFFER_LIMIT,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT,
  DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT,
  DEFAULT_SQLITE_BUSY_MAX_RETRIES,
  DEFAULT_SQLITE_BUSY_RETRY_BASE_DELAY_MS,
  DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
  DEFAULT_SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES,
  DEFAULT_SQLITE_INCREMENTAL_VACUUM_STEP_PAGES,
  DEFAULT_SQLITE_INIT_RETRY_COOLDOWN_MS,
  DEFAULT_SQLITE_MAX_DB_SIZE_MB,
  DEFAULT_SQLITE_RETENTION_COMPACTION_BATCH_SIZE,
  DEFAULT_SQLITE_RETENTION_HOT_DAYS,
  DEFAULT_SQLITE_WAL_CHECKPOINT_INTERVAL_MS,
  DEFAULT_SQLITE_WORKER_ENABLED,
  DEFAULT_SQLITE_WORKER_REQUEST_TIMEOUT_MS,
  DEFAULT_TERMINAL_OUTPUT_HARD_CAP_BYTES,
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WS_HOST,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DEFAULT_WS_PORT,
  HARD_MAX_SESSION_LIST_PAGE_LIMIT,
  HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT,
  HARD_MAX_SQLITE_RETENTION_COMPACTION_BATCH_SIZE,
} from "./constants";

/** Zod schema for environment variable validation */
const envSchema = z.object({
  SESSION_IDLE_TIMEOUT_MS: z.string().optional(),
  SESSION_BUFFER_LIMIT: z.string().optional(),
  WS_HEARTBEAT_INTERVAL_MS: z.string().optional(),
  WS_MAX_PAYLOAD_BYTES: z.string().optional(),
  WS_PORT: z.string().optional(),
  WS_HOST: z.string().optional(),
  AGENT_TIMEOUT_MS: z.string().optional(),
  TERMINAL_TIMEOUT_MS: z.string().optional(),
  TERMINAL_OUTPUT_HARD_CAP_BYTES: z.string().optional(),
  ALLOWED_AGENT_COMMANDS: z.string().optional(),
  ALLOWED_TERMINAL_COMMANDS: z.string().optional(),
  ALLOWED_ENV_KEYS: z.string().optional(),
  SESSION_LIST_PAGE_MAX_LIMIT: z.string().optional(),
  SESSION_MESSAGES_PAGE_MAX_LIMIT: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().optional(),
  AUTH_BASE_URL: z.string().optional(),
  BETTER_AUTH_URL: z.string().optional(),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  AUTH_ADMIN_USERNAME: z.string().optional(),
  AUTH_ADMIN_PASSWORD: z.string().optional(),
  AUTH_ADMIN_EMAIL: z.string().optional(),
  AUTH_ALLOW_SIGNUP: z.string().optional(),
  AUTH_DB_PATH: z.string().optional(),
  AUTH_BOOTSTRAP_API_KEY: z.string().optional(),
  AUTH_API_KEY_PREFIX: z.string().optional(),
  AUTH_API_KEY_RATE_LIMIT_ENABLED: z.string().optional(),
  AUTH_API_KEY_RATE_LIMIT_TIME_WINDOW_MS: z.string().optional(),
  AUTH_API_KEY_RATE_LIMIT_MAX_REQUESTS: z.string().optional(),
  CORS_STRICT_ORIGIN: z.string().optional(),
  LOG_BUFFER_LIMIT: z.string().optional(),
  LOG_FLUSH_INTERVAL_MS: z.string().optional(),
  LOG_RETENTION_DAYS: z.string().optional(),
  LOG_FILE_ENABLED: z.string().optional(),
  BACKGROUND_ENABLED: z.string().optional(),
  BACKGROUND_TICK_MS: z.string().optional(),
  BACKGROUND_TASK_TIMEOUT_MS: z.string().optional(),
  BACKGROUND_SESSION_CLEANUP_INTERVAL_MS: z.string().optional(),
  BACKGROUND_CACHE_PRUNE_INTERVAL_MS: z.string().optional(),
  BACKGROUND_SQLITE_MAINTENANCE_INTERVAL_MS: z.string().optional(),
  SQLITE_BUSY_TIMEOUT_MS: z.string().optional(),
  SQLITE_BUSY_MAX_RETRIES: z.string().optional(),
  SQLITE_BUSY_RETRY_BASE_DELAY_MS: z.string().optional(),
  SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES: z.string().optional(),
  SQLITE_INCREMENTAL_VACUUM_STEP_PAGES: z.string().optional(),
  SQLITE_WAL_CHECKPOINT_INTERVAL_MS: z.string().optional(),
  SQLITE_RETENTION_HOT_DAYS: z.string().optional(),
  SQLITE_RETENTION_COMPACTION_BATCH_SIZE: z.string().optional(),
  SQLITE_MAX_DB_SIZE_MB: z.string().optional(),
  SQLITE_MIGRATIONS_DIR: z.string().optional(),
  SQLITE_INIT_RETRY_COOLDOWN_MS: z.string().optional(),
  SQLITE_WORKER_ENABLED: z.string().optional(),
  SQLITE_WORKER_REQUEST_TIMEOUT_MS: z.string().optional(),
  MESSAGE_CONTENT_MAX_BYTES: z.string().optional(),
  MESSAGE_PARTS_MAX_BYTES: z.string().optional(),
  ACP_REQUEST_MAX_ATTEMPTS: z.string().optional(),
  ACP_REQUEST_RETRY_BASE_DELAY_MS: z.string().optional(),
  NODE_ENV: z.string().optional(),
  BUN_ENV: z.string().optional(),
});

/** Parse environment variables */
const env = envSchema.parse(process.env);

/**
 * Converts a string environment variable to a number with fallback
 *
 * @param value - The string value to convert
 * @param fallback - The fallback number if conversion fails or value is empty
 * @returns The parsed number or fallback
 */
function toNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Converts a string environment variable to an optional number
 *
 * @param value - The string value to convert
 * @returns The parsed number or undefined if invalid/empty
 */
function toOptionalNumber(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

/**
 * Converts a string environment variable to a positive integer with fallback
 */
function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

/**
 * Converts a string environment variable to a bounded positive integer
 */
function toBoundedPositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = toPositiveInt(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Converts a comma-separated list into a string array
 *
 * @param value - The string list value to convert
 * @returns Array of trimmed, non-empty entries
 */
function toList(value: string | undefined) {
  if (!value) {
    return [];
  }
  if (value.trim() === "*") {
    return ["*"];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Converts a string environment variable to a boolean
 *
 * @param value - The string value to convert
 * @param fallback - The fallback boolean if value is empty
 * @returns The parsed boolean or fallback
 */
function toBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseRequiredAllowlist(
  name: string,
  value: string | undefined,
  errors: string[]
): string[] {
  if (!value || value.trim().length === 0) {
    errors.push(`${name} must be a non-empty comma-separated allowlist.`);
    return [];
  }

  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (entries.length === 0) {
    errors.push(`${name} must contain at least one explicit entry.`);
    return [];
  }

  if (entries.includes("*")) {
    errors.push(
      `${name} does not support wildcard '*'; list entries explicitly.`
    );
    return [];
  }

  return [...new Set(entries)];
}

const wsPort = toNumber(env.WS_PORT, DEFAULT_WS_PORT);
const wsHost = env.WS_HOST ?? DEFAULT_WS_HOST;
const normalizedAuthHost = wsHost === "0.0.0.0" ? "localhost" : wsHost;
const runtimeEnv = env.NODE_ENV ?? env.BUN_ENV ?? "production";
const isProd = runtimeEnv === "production";
const isDev = !isProd;
const sqliteWorkerEnabled = toBoolean(
  env.SQLITE_WORKER_ENABLED,
  DEFAULT_SQLITE_WORKER_ENABLED
);
if (isProd && !sqliteWorkerEnabled) {
  throw new Error(
    "[Config] SQLITE_WORKER_ENABLED must be true in production runtime."
  );
}
const defaultApiKeyRateLimitWindowMs = 60_000;
const defaultApiKeyRateLimitMaxRequests = 3000;
const authBaseUrl =
  env.AUTH_BASE_URL ??
  env.BETTER_AUTH_URL ??
  `http://${normalizedAuthHost}:${wsPort}`;
const allowlistErrors: string[] = [];
const allowedAgentCommands = parseRequiredAllowlist(
  "ALLOWED_AGENT_COMMANDS",
  env.ALLOWED_AGENT_COMMANDS,
  allowlistErrors
);
const allowedTerminalCommands = parseRequiredAllowlist(
  "ALLOWED_TERMINAL_COMMANDS",
  env.ALLOWED_TERMINAL_COMMANDS,
  allowlistErrors
);
const allowedEnvKeys = parseRequiredAllowlist(
  "ALLOWED_ENV_KEYS",
  env.ALLOWED_ENV_KEYS,
  allowlistErrors
);
if (allowlistErrors.length > 0) {
  throw new Error(
    [
      "[Config] Invalid required allowlist configuration:",
      ...allowlistErrors.map((error) => `- ${error}`),
      "Expected format: NAME=item1,item2,item3",
    ].join("\n")
  );
}
const authTrustedOrigins = toList(env.AUTH_TRUSTED_ORIGINS);
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
  /** Runtime environment */
  runtimeEnv,
  /** True when running in development or test modes */
  isDev,
  /** True when running in production mode */
  isProd,
  /** Timeout for idle sessions in milliseconds */
  sessionIdleTimeoutMs: toNumber(
    env.SESSION_IDLE_TIMEOUT_MS,
    DEFAULT_SESSION_IDLE_TIMEOUT_MS
  ),
  /** Maximum number of messages to buffer per session */
  sessionBufferLimit: toNumber(
    env.SESSION_BUFFER_LIMIT,
    DEFAULT_SESSION_BUFFER_LIMIT
  ),
  /** WebSocket heartbeat interval in milliseconds */
  wsHeartbeatIntervalMs: toNumber(
    env.WS_HEARTBEAT_INTERVAL_MS,
    DEFAULT_WS_HEARTBEAT_INTERVAL_MS
  ),
  /** Maximum accepted payload per WebSocket message/frame in bytes */
  wsMaxPayloadBytes: toNumber(
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
  authSecret: env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET,
  /** Better Auth base URL */
  authBaseUrl,
  /** Better Auth trusted origins */
  authTrustedOrigins,
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
  logBufferLimit: toNumber(env.LOG_BUFFER_LIMIT, DEFAULT_LOG_BUFFER_LIMIT),
  /** Log flush interval in milliseconds */
  logFlushIntervalMs: toNumber(
    env.LOG_FLUSH_INTERVAL_MS,
    DEFAULT_LOG_FLUSH_INTERVAL_MS
  ),
  /** Optional log retention days (undefined to keep all) */
  logRetentionDays: toOptionalNumber(env.LOG_RETENTION_DAYS),
  /** Enable log file sink */
  logFileEnabled: toBoolean(env.LOG_FILE_ENABLED, true),
  /** Enable background runner */
  backgroundEnabled: toBoolean(env.BACKGROUND_ENABLED, true),
  /** Background runner tick interval in milliseconds */
  backgroundTickMs: toNumber(
    env.BACKGROUND_TICK_MS,
    DEFAULT_BACKGROUND_TICK_MS
  ),
  /** Timeout for a single background task run in milliseconds */
  backgroundTaskTimeoutMs: toNumber(
    env.BACKGROUND_TASK_TIMEOUT_MS,
    DEFAULT_BACKGROUND_TASK_TIMEOUT_MS
  ),
  /** Interval for session idle cleanup task in milliseconds */
  backgroundSessionCleanupIntervalMs: toNumber(
    env.BACKGROUND_SESSION_CLEANUP_INTERVAL_MS,
    DEFAULT_BACKGROUND_SESSION_CLEANUP_INTERVAL_MS
  ),
  /** Interval for cache prune task in milliseconds */
  backgroundCachePruneIntervalMs: toNumber(
    env.BACKGROUND_CACHE_PRUNE_INTERVAL_MS,
    DEFAULT_BACKGROUND_CACHE_PRUNE_INTERVAL_MS
  ),
  /** Interval for sqlite maintenance task in milliseconds */
  backgroundSqliteMaintenanceIntervalMs: toNumber(
    env.BACKGROUND_SQLITE_MAINTENANCE_INTERVAL_MS,
    DEFAULT_BACKGROUND_SQLITE_MAINTENANCE_INTERVAL_MS
  ),
  /** Cooldown before retrying a failed SQLite init */
  sqliteInitRetryCooldownMs: toNumber(
    env.SQLITE_INIT_RETRY_COOLDOWN_MS,
    DEFAULT_SQLITE_INIT_RETRY_COOLDOWN_MS
  ),
  /** SQLite busy timeout in milliseconds */
  sqliteBusyTimeoutMs: toPositiveInt(
    env.SQLITE_BUSY_TIMEOUT_MS,
    DEFAULT_SQLITE_BUSY_TIMEOUT_MS
  ),
  /** Maximum retries for SQLITE_BUSY operations */
  sqliteBusyMaxRetries: toPositiveInt(
    env.SQLITE_BUSY_MAX_RETRIES,
    DEFAULT_SQLITE_BUSY_MAX_RETRIES
  ),
  /** Base delay for SQLITE_BUSY retry backoff */
  sqliteBusyRetryBaseDelayMs: toPositiveInt(
    env.SQLITE_BUSY_RETRY_BASE_DELAY_MS,
    DEFAULT_SQLITE_BUSY_RETRY_BASE_DELAY_MS
  ),
  /** Minimum free pages before incremental vacuum kicks in */
  sqliteIncrementalVacuumMinFreePages: toPositiveInt(
    env.SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES,
    DEFAULT_SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES
  ),
  /** Maximum pages reclaimed per incremental vacuum pass */
  sqliteIncrementalVacuumStepPages: toPositiveInt(
    env.SQLITE_INCREMENTAL_VACUUM_STEP_PAGES,
    DEFAULT_SQLITE_INCREMENTAL_VACUUM_STEP_PAGES
  ),
  /** Interval between WAL checkpoints in milliseconds */
  sqliteWalCheckpointIntervalMs: toPositiveInt(
    env.SQLITE_WAL_CHECKPOINT_INTERVAL_MS,
    DEFAULT_SQLITE_WAL_CHECKPOINT_INTERVAL_MS
  ),
  /** Number of days to retain full message payload before compaction */
  sqliteRetentionHotDays: toPositiveInt(
    env.SQLITE_RETENTION_HOT_DAYS,
    DEFAULT_SQLITE_RETENTION_HOT_DAYS
  ),
  /** Maximum compacted rows per maintenance batch */
  sqliteRetentionCompactionBatchSize: toBoundedPositiveInt(
    env.SQLITE_RETENTION_COMPACTION_BATCH_SIZE,
    DEFAULT_SQLITE_RETENTION_COMPACTION_BATCH_SIZE,
    1,
    HARD_MAX_SQLITE_RETENTION_COMPACTION_BATCH_SIZE
  ),
  /** Soft alert threshold for SQLite DB size */
  sqliteMaxDbSizeMb: toPositiveInt(
    env.SQLITE_MAX_DB_SIZE_MB,
    DEFAULT_SQLITE_MAX_DB_SIZE_MB
  ),
  /** Enable SQLite worker-thread request offloading */
  sqliteWorkerEnabled,
  /** Timeout for one SQLite worker request in milliseconds */
  sqliteWorkerRequestTimeoutMs: toPositiveInt(
    env.SQLITE_WORKER_REQUEST_TIMEOUT_MS,
    DEFAULT_SQLITE_WORKER_REQUEST_TIMEOUT_MS
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
  /** Optional override path for SQLite drizzle migrations directory */
  sqliteMigrationsDir: env.SQLITE_MIGRATIONS_DIR?.trim() || undefined,
};
