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
/** Default in-memory log buffer size */
export const DEFAULT_LOG_BUFFER_LIMIT = 2000;
/** Default log query limit for UI requests */
export const DEFAULT_LOG_QUERY_LIMIT = 200;
/** Maximum log query limit */
export const MAX_LOG_QUERY_LIMIT = 1000;
/** Default log file flush interval in milliseconds */
export const DEFAULT_LOG_FLUSH_INTERVAL_MS = 250;
