/**
 * Application Constants
 *
 * Defines all hardcoded configuration values used throughout the application.
 * These values can be overridden via environment variables where applicable.
 *
 * @module config/constants
 */
import { isWindows } from "@/shared/utils/runtime-platform.util";

/** Client information sent to agents during connection */
export const CLIENT_INFO = { name: "eragear-code-copilot", version: "0.0.1" };

/** Default session idle timeout: 10 minutes in milliseconds */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** Default WebSocket server port */
export const DEFAULT_WS_PORT = 3000;
/** Default WebSocket server host (local-only by default) */
export const DEFAULT_WS_HOST = "127.0.0.1";
/** Default maximum number of messages to buffer per session */
export const DEFAULT_SESSION_BUFFER_LIMIT = 500;
/** Default warning threshold for per-chat runtime lock wait latency */
export const DEFAULT_SESSION_LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
/** Max time budget for one event bus publish attempt from session runtime */
export const DEFAULT_SESSION_EVENT_BUS_PUBLISH_TIMEOUT_MS = 250;
/** Max queued event bus publish jobs per chat before dropping new jobs */
export const DEFAULT_SESSION_EVENT_BUS_PUBLISH_MAX_QUEUE_PER_CHAT = 512;
/** Dev fallback allowlist for spawning configured agent commands */
export const DEFAULT_DEV_ALLOWED_AGENT_COMMANDS = [process.execPath] as const;
function resolveDefaultWindowsShellPath(): string {
  const comSpec = process.env.ComSpec ?? process.env.COMSPEC;
  if (typeof comSpec === "string" && comSpec.trim().length > 0) {
    return comSpec;
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (typeof systemRoot === "string" && systemRoot.trim().length > 0) {
    return `${systemRoot}\\System32\\cmd.exe`;
  }
  return "C:\\Windows\\System32\\cmd.exe";
}
/** Dev fallback allowlist for terminal tool command execution */
export const DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS = [
  isWindows() ? resolveDefaultWindowsShellPath() : "/bin/sh",
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
/** Default maximum HTTP request body size for JSON API endpoints */
export const DEFAULT_HTTP_MAX_BODY_BYTES = 2 * 1024 * 1024;
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
/** Default cooldown before retrying failed storage initialization */
export const DEFAULT_STORAGE_INIT_RETRY_COOLDOWN_MS = 60_000;
/** Default storage busy timeout in milliseconds */
export const DEFAULT_STORAGE_BUSY_TIMEOUT_MS = 10_000;
/** Minimum free pages before running incremental vacuum */
export const DEFAULT_STORAGE_INCREMENTAL_VACUUM_MIN_FREE_PAGES = 1024;
/** Number of pages reclaimed per incremental vacuum pass */
export const DEFAULT_STORAGE_INCREMENTAL_VACUUM_STEP_PAGES = 512;
/** Default interval for WAL checkpoint maintenance */
export const DEFAULT_STORAGE_WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
/** Default retention window for full message payloads */
export const DEFAULT_STORAGE_RETENTION_HOT_DAYS = 30;
/** Default max messages compacted in one maintenance batch */
export const DEFAULT_STORAGE_RETENTION_COMPACTION_BATCH_SIZE = 150;
/** Default soft alert threshold for storage DB size */
export const DEFAULT_STORAGE_MAX_DB_SIZE_MB = 2048;
/** Default max retries for storage busy operations */
export const DEFAULT_STORAGE_BUSY_MAX_RETRIES = 5;
/** Base delay for storage busy retry backoff */
export const DEFAULT_STORAGE_BUSY_RETRY_BASE_DELAY_MS = 25;
/** Max pending SQLite write tasks before rejecting new enqueues */
export const DEFAULT_SQLITE_WRITE_QUEUE_MAX_PENDING = 5000;
/** Default max storage bind parameters per statement */
export const DEFAULT_STORAGE_MAX_BIND_PARAMS = 900;
/** Default max ACP request attempts for transient transport errors */
export const DEFAULT_ACP_REQUEST_MAX_ATTEMPTS = 3;
/** Default base retry delay for ACP request retries */
export const DEFAULT_ACP_REQUEST_RETRY_BASE_DELAY_MS = 150;
/** Maximum NDJSON line size accepted from ACP agent stdout */
export const DEFAULT_ACP_NDJSON_MAX_LINE_BYTES = 1024 * 1024;
/** Maximum buffered NDJSON bytes accepted before fail-fast termination */
export const DEFAULT_ACP_NDJSON_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** Maximum cumulative stderr bytes accepted from one ACP process before termination */
export const DEFAULT_ACP_STDERR_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
/** Hard cap for compaction batch size per run */
export const HARD_MAX_STORAGE_RETENTION_COMPACTION_BATCH_SIZE = 500;
/** Hard cap for storage bind parameter configuration */
export const HARD_MAX_STORAGE_MAX_BIND_PARAMS = 32_766;
/** Enable storage worker-thread offloading by default */
export const DEFAULT_STORAGE_WORKER_ENABLED = true;
/** Default timeout for one storage worker request */
export const DEFAULT_STORAGE_WORKER_REQUEST_TIMEOUT_MS = 30_000;
/** Allow unknown filesystem types for storage path safety checks */
export const DEFAULT_STORAGE_ALLOW_UNKNOWN_FS = false;
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
/** Default interval for storage maintenance background task */
export const DEFAULT_BACKGROUND_STORAGE_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
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
/** Require Cloudflare Access auth headers on WebSocket/tRPC handshakes */
export const DEFAULT_AUTH_REQUIRE_CLOUDFLARE_ACCESS = false;
