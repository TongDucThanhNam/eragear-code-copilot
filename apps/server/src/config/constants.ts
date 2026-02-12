/**
 * Application Constants
 *
 * Defines all hardcoded configuration values used throughout the application.
 * These values can be overridden via environment variables where applicable.
 *
 * @module config/constants
 */

/** Client information sent to agents during connection */
export const CLIENT_INFO = { name: "eragear-code-copilot", version: "0.0.1" };

/** Default session idle timeout: 10 minutes in milliseconds */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** Default WebSocket server port */
export const DEFAULT_WS_PORT = 3000;
/** Default WebSocket server host (binds to all interfaces) */
export const DEFAULT_WS_HOST = "0.0.0.0";
/** Default maximum number of messages to buffer per session */
export const DEFAULT_SESSION_BUFFER_LIMIT = 500;
/** Default timeout while waiting to acquire a per-chat runtime lock */
export const DEFAULT_SESSION_LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
/** Max time budget for one event bus publish attempt from session runtime */
export const DEFAULT_SESSION_EVENT_BUS_PUBLISH_TIMEOUT_MS = 250;
/** Max queued event bus publish jobs per chat before dropping new jobs */
export const DEFAULT_SESSION_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT = 512;
/** Dev fallback allowlist for spawning configured agent commands */
export const DEFAULT_DEV_ALLOWED_AGENT_COMMANDS = [
  "opencode",
  "codex",
  "claude",
  "gemini",
  "bun",
  "node",
] as const;
/** Dev fallback allowlist for terminal tool command execution */
export const DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS = [
  "ls",
  "grep",
  "cat",
  "find",
  "git",
  "echo",
  "mkdir",
  "touch",
  "pwd",
  "whoami",
] as const;
/** Dev fallback allowlist for inherited environment variable keys */
export const DEFAULT_DEV_ALLOWED_ENV_KEYS = [
  "PATH",
  "HOME",
  "NODE_ENV",
  "BUN_ENV",
  "TERM",
  "SHELL",
  "DEBUG",
] as const;
/** Default WebSocket heartbeat interval: 30 seconds in milliseconds */
export const DEFAULT_WS_HEARTBEAT_INTERVAL_MS = 30_000;
/** Default maximum WebSocket payload size: 16 MiB */
export const DEFAULT_WS_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
/** Default in-memory log buffer size */
export const DEFAULT_LOG_BUFFER_LIMIT = 2000;
/** Default log query limit for UI requests */
export const DEFAULT_LOG_QUERY_LIMIT = 200;
/** Maximum log query limit */
export const MAX_LOG_QUERY_LIMIT = 1000;
/** Default log file flush interval in milliseconds */
export const DEFAULT_LOG_FLUSH_INTERVAL_MS = 250;
/** Default background runner tick interval in milliseconds */
export const DEFAULT_BACKGROUND_TICK_MS = 1000;
/** Default background task timeout in milliseconds */
export const DEFAULT_BACKGROUND_TASK_TIMEOUT_MS = 30_000;
/** Default interval for session idle cleanup task in milliseconds */
export const DEFAULT_BACKGROUND_SESSION_CLEANUP_INTERVAL_MS = 15_000;
/** Default interval for cache prune task in milliseconds */
export const DEFAULT_BACKGROUND_CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
/** Default cooldown before retrying a failed SQLite initialization */
export const DEFAULT_SQLITE_INIT_RETRY_COOLDOWN_MS = 60_000;
/** Storage-agnostic alias for init retry cooldown */
export const DEFAULT_STORAGE_INIT_RETRY_COOLDOWN_MS =
  DEFAULT_SQLITE_INIT_RETRY_COOLDOWN_MS;
/** Default SQLite busy timeout in milliseconds */
export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 10_000;
/** Storage-agnostic alias for busy timeout */
export const DEFAULT_STORAGE_BUSY_TIMEOUT_MS = DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
/** Minimum free pages before running incremental vacuum */
export const DEFAULT_SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES = 1024;
/** Storage-agnostic alias for incremental vacuum trigger */
export const DEFAULT_STORAGE_INCREMENTAL_VACUUM_MIN_FREE_PAGES =
  DEFAULT_SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES;
/** Number of pages reclaimed per incremental vacuum pass */
export const DEFAULT_SQLITE_INCREMENTAL_VACUUM_STEP_PAGES = 512;
/** Storage-agnostic alias for incremental vacuum step */
export const DEFAULT_STORAGE_INCREMENTAL_VACUUM_STEP_PAGES =
  DEFAULT_SQLITE_INCREMENTAL_VACUUM_STEP_PAGES;
/** Default interval for WAL checkpoint maintenance */
export const DEFAULT_SQLITE_WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
/** Storage-agnostic alias for checkpoint interval */
export const DEFAULT_STORAGE_WAL_CHECKPOINT_INTERVAL_MS =
  DEFAULT_SQLITE_WAL_CHECKPOINT_INTERVAL_MS;
/** Default retention window for full message payloads */
export const DEFAULT_SQLITE_RETENTION_HOT_DAYS = 30;
/** Storage-agnostic alias for hot retention days */
export const DEFAULT_STORAGE_RETENTION_HOT_DAYS =
  DEFAULT_SQLITE_RETENTION_HOT_DAYS;
/** Default max messages compacted in one maintenance batch */
export const DEFAULT_SQLITE_RETENTION_COMPACTION_BATCH_SIZE = 150;
/** Storage-agnostic alias for compaction batch size */
export const DEFAULT_STORAGE_RETENTION_COMPACTION_BATCH_SIZE =
  DEFAULT_SQLITE_RETENTION_COMPACTION_BATCH_SIZE;
/** Default soft alert threshold for SQLite DB size */
export const DEFAULT_SQLITE_MAX_DB_SIZE_MB = 2048;
/** Storage-agnostic alias for DB size soft threshold */
export const DEFAULT_STORAGE_MAX_DB_SIZE_MB = DEFAULT_SQLITE_MAX_DB_SIZE_MB;
/** Default max retries for SQLITE_BUSY operations */
export const DEFAULT_SQLITE_BUSY_MAX_RETRIES = 5;
/** Storage-agnostic alias for busy retry attempts */
export const DEFAULT_STORAGE_BUSY_MAX_RETRIES = DEFAULT_SQLITE_BUSY_MAX_RETRIES;
/** Base delay for SQLITE_BUSY retry backoff */
export const DEFAULT_SQLITE_BUSY_RETRY_BASE_DELAY_MS = 25;
/** Storage-agnostic alias for busy retry delay */
export const DEFAULT_STORAGE_BUSY_RETRY_BASE_DELAY_MS =
  DEFAULT_SQLITE_BUSY_RETRY_BASE_DELAY_MS;
/** Default max SQLite bind parameters per statement */
export const DEFAULT_SQLITE_MAX_BIND_PARAMS = 900;
/** Storage-agnostic alias for max bind parameters */
export const DEFAULT_STORAGE_MAX_BIND_PARAMS = DEFAULT_SQLITE_MAX_BIND_PARAMS;
/** Default max ACP request attempts for transient transport errors */
export const DEFAULT_ACP_REQUEST_MAX_ATTEMPTS = 3;
/** Default base retry delay for ACP request retries */
export const DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS = 150;
/** Maximum NDJSON line size accepted from ACP agent stdout */
export const DEFAULT_ACP_NDJSON_MAX_LINE_BYTES = 1024 * 1024;
/** Maximum buffered NDJSON bytes accepted before fail-fast termination */
export const DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** Hard cap for compaction batch size per run */
export const HARD_MAX_SQLITE_RETENTION_COMPACTION_BATCH_SIZE = 500;
/** Storage-agnostic alias for compaction batch hard cap */
export const HARD_MAX_STORAGE_RETENTION_COMPACTION_BATCH_SIZE =
  HARD_MAX_SQLITE_RETENTION_COMPACTION_BATCH_SIZE;
/** Hard cap for SQLite bind parameter configuration */
export const HARD_MAX_SQLITE_MAX_BIND_PARAMS = 32_766;
/** Storage-agnostic alias for bind parameter hard cap */
export const HARD_MAX_STORAGE_MAX_BIND_PARAMS = HARD_MAX_SQLITE_MAX_BIND_PARAMS;
/** Enable SQLite worker-thread offloading by default */
export const DEFAULT_SQLITE_WORKER_ENABLED = true;
/** Storage-agnostic alias for worker toggle */
export const DEFAULT_STORAGE_WORKER_ENABLED = DEFAULT_SQLITE_WORKER_ENABLED;
/** Default timeout for one SQLite worker request */
export const DEFAULT_SQLITE_WORKER_REQUEST_TIMEOUT_MS = 30_000;
/** Storage-agnostic alias for worker request timeout */
export const DEFAULT_STORAGE_WORKER_REQUEST_TIMEOUT_MS =
  DEFAULT_SQLITE_WORKER_REQUEST_TIMEOUT_MS;
/** Default page size for session list endpoints */
export const DEFAULT_SESSION_LIST_PAGE_LIMIT = 200;
/** Default max page size for session list endpoints */
export const DEFAULT_SESSION_LIST_PAGE_MAX_LIMIT = 500;
/** Hard cap for max page size of session list endpoints */
export const HARD_MAX_SESSION_LIST_PAGE_LIMIT = 5000;
/** Default page size for session messages endpoints */
export const DEFAULT_SESSION_MESSAGES_PAGE_LIMIT = 100;
/** Default max page size for session messages endpoints */
export const DEFAULT_SESSION_MESSAGES_PAGE_MAX_LIMIT = 200;
/** Hard cap for max page size of session messages endpoints */
export const HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT = 2000;
/** Hard cap for retained terminal output when no request limit is provided */
export const DEFAULT_TERMINAL_OUTPUT_HARD_CAP_BYTES = 4 * 1024 * 1024;
/** Maximum allowed bytes for message content payload */
export const DEFAULT_MESSAGE_CONTENT_MAX_BYTES = 2 * 1024 * 1024;
/** Maximum allowed bytes for serialized message parts payload */
export const DEFAULT_MESSAGE_PARTS_MAX_BYTES = 4 * 1024 * 1024;
/** Default interval for SQLite maintenance background task */
export const DEFAULT_BACKGROUND_SQLITE_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
/** Storage-agnostic alias for maintenance background task */
export const DEFAULT_BACKGROUND_STORAGE_MAINTENANCE_INTERVAL_MS =
  DEFAULT_BACKGROUND_SQLITE_MAINTENANCE_INTERVAL_MS;
/** Default runtime log level for structured and request logs */
export const DEFAULT_APP_LOG_LEVEL = "info";
/** Default runtime max tokens policy for prompt requests */
export const DEFAULT_APP_MAX_TOKENS = 8192;
/** Hard cap for runtime max tokens policy */
export const HARD_MAX_APP_MAX_TOKENS = 200_000;
/** Default runtime model preference (empty means agent default) */
export const DEFAULT_APP_DEFAULT_MODEL = "";
/** Maximum allowed length for runtime default model identifier */
export const MAX_APP_DEFAULT_MODEL_LENGTH = 200;
/** Default TTL for auth bootstrap ensure-defaults cache */
export const DEFAULT_AUTH_BOOTSTRAP_ENSURE_DEFAULTS_TTL_MS = 30 * 60 * 1000;
/** Default max users retained in auth bootstrap success cache */
export const DEFAULT_AUTH_BOOTSTRAP_CACHE_MAX_USERS = 10_000;
/** Default max in-flight ensure-defaults tasks tracked for auth bootstrap */
export const DEFAULT_AUTH_BOOTSTRAP_INFLIGHT_MAX_USERS = 2000;
