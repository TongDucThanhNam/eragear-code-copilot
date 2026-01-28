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
  DEFAULT_SESSION_BUFFER_LIMIT,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WS_HOST,
  DEFAULT_WS_PORT,
} from "./constants";

/** Zod schema for environment variable validation */
const envSchema = z.object({
  SESSION_IDLE_TIMEOUT_MS: z.string().optional(),
  SESSION_BUFFER_LIMIT: z.string().optional(),
  WS_HEARTBEAT_INTERVAL_MS: z.string().optional(),
  WS_PORT: z.string().optional(),
  WS_HOST: z.string().optional(),
  AGENT_TIMEOUT_MS: z.string().optional(),
  TERMINAL_TIMEOUT_MS: z.string().optional(),
  ALLOWED_AGENT_COMMANDS: z.string().optional(),
  ALLOWED_TERMINAL_COMMANDS: z.string().optional(),
  ALLOWED_ENV_KEYS: z.string().optional(),
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

const wsPort = toNumber(env.WS_PORT, DEFAULT_WS_PORT);
const wsHost = env.WS_HOST ?? DEFAULT_WS_HOST;
const normalizedAuthHost = wsHost === "0.0.0.0" ? "localhost" : wsHost;
const authBaseUrl =
  env.AUTH_BASE_URL ??
  env.BETTER_AUTH_URL ??
  `http://${normalizedAuthHost}:${wsPort}`;
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
  /** WebSocket server port */
  wsPort,
  /** WebSocket server host */
  wsHost,
  /** Optional maximum agent runtime duration in milliseconds */
  agentTimeoutMs: toOptionalNumber(env.AGENT_TIMEOUT_MS),
  /** Optional maximum terminal runtime duration in milliseconds */
  terminalTimeoutMs: toOptionalNumber(env.TERMINAL_TIMEOUT_MS),
  /** Optional allowlist of agent commands (empty = allow all) */
  allowedAgentCommands: toList(env.ALLOWED_AGENT_COMMANDS),
  /** Optional allowlist of terminal commands (empty = allow all) */
  allowedTerminalCommands: toList(env.ALLOWED_TERMINAL_COMMANDS),
  /** Optional allowlist of environment variable keys (empty = allow all) */
  allowedEnvKeys: toList(env.ALLOWED_ENV_KEYS),
  /** Better Auth secret (persisted or env) */
  authSecret: env.AUTH_SECRET ?? env.BETTER_AUTH_SECRET,
  /** Better Auth base URL */
  authBaseUrl,
  /** Better Auth trusted origins */
  authTrustedOrigins,
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
};
