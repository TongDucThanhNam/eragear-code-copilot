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
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
  wsPort: toNumber(env.WS_PORT, DEFAULT_WS_PORT),
  /** WebSocket server host */
  wsHost: env.WS_HOST ?? DEFAULT_WS_HOST,
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
};
