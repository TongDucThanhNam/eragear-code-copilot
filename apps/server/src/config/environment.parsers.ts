import { LOG_LEVELS, type LogLevel } from "@/shared/types/log.types";

/**
 * Converts a string environment variable to a number with fallback
 */
export function toNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Converts a string environment variable to an optional number
 */
export function toOptionalNumber(value: string | undefined) {
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
export function toPositiveInt(
  value: string | undefined,
  fallback: number
): number {
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
export function toBoundedPositiveInt(
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
 */
export function toList(value: string | undefined) {
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
 */
export function toBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const LOG_LEVEL_SET = new Set(LOG_LEVELS);

export function toLogLevel(
  value: string | undefined,
  fallback: LogLevel
): LogLevel {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (LOG_LEVEL_SET.has(normalized as LogLevel)) {
    return normalized as LogLevel;
  }
  return fallback;
}

export function toTrimmedString(
  value: string | undefined,
  fallback: string
): string {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function firstNonEmpty(
  values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

export function parseRequiredAllowlist(
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
