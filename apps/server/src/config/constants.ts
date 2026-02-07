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
/** Default page size for session list endpoints */
export const DEFAULT_SESSION_LIST_PAGE_LIMIT = 200;
/** Maximum page size for session list endpoints */
export const MAX_SESSION_LIST_PAGE_LIMIT = 500;
