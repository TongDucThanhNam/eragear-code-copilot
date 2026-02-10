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
/** Default SQLite busy timeout in milliseconds */
export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 10_000;
/** Minimum free pages before running incremental vacuum */
export const DEFAULT_SQLITE_INCREMENTAL_VACUUM_MIN_FREE_PAGES = 1024;
/** Number of pages reclaimed per incremental vacuum pass */
export const DEFAULT_SQLITE_INCREMENTAL_VACUUM_STEP_PAGES = 512;
/** Default interval for WAL checkpoint maintenance */
export const DEFAULT_SQLITE_WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
/** Default retention window for full message payloads */
export const DEFAULT_SQLITE_RETENTION_HOT_DAYS = 30;
/** Default max messages compacted in one maintenance batch */
export const DEFAULT_SQLITE_RETENTION_COMPACTION_BATCH_SIZE = 150;
/** Default soft alert threshold for SQLite DB size */
export const DEFAULT_SQLITE_MAX_DB_SIZE_MB = 2048;
/** Default max retries for SQLITE_BUSY operations */
export const DEFAULT_SQLITE_BUSY_MAX_RETRIES = 5;
/** Base delay for SQLITE_BUSY retry backoff */
export const DEFAULT_SQLITE_BUSY_RETRY_BASE_DELAY_MS = 25;
/** Enable SQLite worker-thread offloading by default */
export const DEFAULT_SQLITE_WORKER_ENABLED = true;
/** Default timeout for one SQLite worker request */
export const DEFAULT_SQLITE_WORKER_REQUEST_TIMEOUT_MS = 30_000;
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
