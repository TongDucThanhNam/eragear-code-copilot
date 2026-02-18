import path from "node:path";
import {
  LOG_LEVELS,
  LOG_OUTPUT_FORMATS,
  type LogLevel,
  type LogOutputFormat,
} from "@/shared/types/log.types";
import type { CommandPolicy } from "@/shared/utils/allowlist.util";
import { isRecord } from "@/shared/utils/type-guards.util";

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
 * Converts a string environment variable to a non-negative integer
 */
export function toNonNegativeInt(
  value: string | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

/**
 * Converts a string environment variable to a TCP port number
 */
export function toPortNumber(
  value: string | undefined,
  fallback: number
): number {
  const parsed = toPositiveInt(value, fallback);
  if (parsed < 1 || parsed > 65_535) {
    return fallback;
  }
  return parsed;
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

/**
 * Parses a strict boolean value and fails on invalid literals.
 */
export function toStrictBoolean(
  value: string | undefined,
  fallback: boolean,
  configKey: string
): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(
    `[Config] ${configKey} must be a strict boolean (true/false, 1/0, yes/no, on/off).`
  );
}

const LOG_LEVEL_SET = new Set(LOG_LEVELS);
const LOG_OUTPUT_FORMAT_SET = new Set(LOG_OUTPUT_FORMATS);

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

export function toLogOutputFormat(
  value: string | undefined,
  fallback: LogOutputFormat
): LogOutputFormat {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (LOG_OUTPUT_FORMAT_SET.has(normalized as LogOutputFormat)) {
    return normalized as LogOutputFormat;
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

export function parseAllowlistWithFallback(
  name: string,
  value: string | undefined,
  fallback: readonly string[],
  warnings: string[]
): string[] {
  const parseErrors: string[] = [];
  const parsed = parseRequiredAllowlist(name, value, parseErrors);
  if (parseErrors.length === 0) {
    return parsed;
  }
  warnings.push(
    `${name} is missing or invalid in non-strict mode; using fallback: ${fallback.join(", ")}`
  );
  return [...fallback];
}

function parseCommandPolicyEntry(
  name: string,
  rawEntry: unknown,
  index: number,
  errors: string[]
): CommandPolicy | null {
  if (!isRecord(rawEntry)) {
    errors.push(`${name}[${index}] must be an object.`);
    return null;
  }

  const command = rawEntry.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    errors.push(`${name}[${index}].command must be a non-empty string.`);
    return null;
  }
  const normalizedCommand = command.trim();
  if (!path.isAbsolute(normalizedCommand)) {
    errors.push(`${name}[${index}].command must be an absolute path.`);
    return null;
  }

  const allowAnyArgs = rawEntry.allowAnyArgs;
  if (allowAnyArgs !== undefined && typeof allowAnyArgs !== "boolean") {
    errors.push(`${name}[${index}].allowAnyArgs must be a boolean when set.`);
    return null;
  }

  const parseStringArray = (
    field: "allowedArgs" | "allowedArgPatterns"
  ): string[] | null => {
    const value = rawEntry[field];
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      errors.push(`${name}[${index}].${field} must be an array of strings.`);
      return null;
    }
    const normalized = value.map((item) =>
      typeof item === "string" ? item.trim() : ""
    );
    if (normalized.some((item) => item.length === 0)) {
      errors.push(
        `${name}[${index}].${field} must contain non-empty string items only.`
      );
      return null;
    }
    return [...new Set(normalized)];
  };

  const allowedArgs = parseStringArray("allowedArgs");
  const allowedArgPatterns = parseStringArray("allowedArgPatterns");
  if (!(allowedArgs && allowedArgPatterns)) {
    return null;
  }
  if (rawEntry.allowedArgPrefixes !== undefined) {
    errors.push(
      `${name}[${index}].allowedArgPrefixes is deprecated; use allowedArgPatterns (anchored regex) instead.`
    );
    return null;
  }

  return {
    command: normalizedCommand,
    allowAnyArgs: allowAnyArgs === true,
    allowedArgs,
    allowedArgPatterns,
  };
}

export function parseRequiredCommandPolicies(
  name: string,
  value: string | undefined,
  errors: string[]
): CommandPolicy[] {
  if (!value || value.trim().length === 0) {
    errors.push(`${name} must be a non-empty JSON array of command policies.`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    errors.push(`${name} must be valid JSON.`);
    return [];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    errors.push(`${name} must be a non-empty JSON array.`);
    return [];
  }

  const commandPolicies: CommandPolicy[] = [];
  const seenCommands = new Set<string>();
  for (let i = 0; i < parsed.length; i += 1) {
    const policy = parseCommandPolicyEntry(name, parsed[i], i, errors);
    if (!policy) {
      continue;
    }
    const normalized = policy.command.trim();
    if (seenCommands.has(normalized)) {
      errors.push(`${name} contains duplicate command policy: ${normalized}.`);
      continue;
    }
    seenCommands.add(normalized);
    commandPolicies.push(policy);
  }

  if (errors.length > 0) {
    return [];
  }

  return commandPolicies;
}

export function parseCommandPoliciesWithFallback(params: {
  policyName: string;
  policyValue: string | undefined;
  fallbackCommands: readonly string[];
  warnings: string[];
}): CommandPolicy[] {
  const { policyName, policyValue, fallbackCommands, warnings } = params;

  const policyErrors: string[] = [];
  const parsedPolicies = parseRequiredCommandPolicies(
    policyName,
    policyValue,
    policyErrors
  );
  if (policyErrors.length === 0) {
    return parsedPolicies;
  }

  warnings.push(
    `${policyName} is missing or invalid in non-strict mode; using configured development fallback policies (allowAnyArgs=true).`
  );
  return fallbackCommands
    .filter((command) => path.isAbsolute(command))
    .map((command) => ({
      command,
      allowAnyArgs: true,
      allowedArgs: [],
      allowedArgPatterns: [],
    }));
}
