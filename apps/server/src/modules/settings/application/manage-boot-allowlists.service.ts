import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type BootRuntimeMode,
  loadBootConfigValues,
  normalizeBootValue,
} from "@/config/boot-config.loader";
import { ENV } from "@/config/environment";
import {
  parseRequiredAllowlist,
  parseRequiredCommandPolicies,
} from "@/config/environment.parsers";
import type { AgentRuntimePort } from "@/modules/session";
import { ValidationError } from "@/shared/errors";
import type { EventBusPort } from "@/shared/ports/event-bus.port";
import type { CommandPolicy } from "@/shared/utils/allowlist.util";
import { isRecord } from "@/shared/utils/type-guards.util";

const OP_UPDATE = "settings.boot_allowlists.update";
const BOOT_CONFIG_PATH_ENV_KEY = "ERAGEAR_BOOT_CONFIG_PATH";
const BOOT_CONFIG_FILE_NAME = "settings.json";
const AGENT_POLICIES_KEY = "ALLOWED_AGENT_COMMAND_POLICIES";
const TERMINAL_POLICIES_KEY = "ALLOWED_TERMINAL_COMMAND_POLICIES";
const ENV_KEYS_KEY = "ALLOWED_ENV_KEYS";

// Boot config keys for common settings
const COMMON_BOOT_KEYS = {
  WS_AUTH_TIMEOUT_MS: "WS_AUTH_TIMEOUT_MS",
  WS_SESSION_REVALIDATE_INTERVAL_MS: "WS_SESSION_REVALIDATE_INTERVAL_MS",
  WS_HEARTBEAT_INTERVAL_MS: "WS_HEARTBEAT_INTERVAL_MS",
  WS_MAX_PAYLOAD_BYTES: "WS_MAX_PAYLOAD_BYTES",
  LOG_FILE_ENABLED: "LOG_FILE_ENABLED",
  LOG_RETENTION_DAYS: "LOG_RETENTION_DAYS",
  ACP_ENABLE_FS_WRITE: "ACP_ENABLE_FS_WRITE",
  ACP_ENABLE_TERMINAL: "ACP_ENABLE_TERMINAL",
  STORAGE_MAX_DB_SIZE_MB: "STORAGE_MAX_DB_SIZE_MB",
  AUTH_ALLOW_SIGNUP: "AUTH_ALLOW_SIGNUP",
} as const;

// Validation constraints for common settings
const COMMON_SETTINGS_CONSTRAINTS = {
  wsAuthTimeoutMs: {
    min: 1000,
    max: 60_000,
    label: "WS Auth Timeout",
    unit: "ms",
  },
  wsSessionRevalidateIntervalMs: {
    min: 10_000,
    max: 3_600_000, // 1 hour
    label: "WS Session Revalidate Interval",
    unit: "ms",
  },
  wsHeartbeatIntervalMs: {
    min: 5000,
    max: 300_000, // 5 minutes
    label: "WS Heartbeat Interval",
    unit: "ms",
  },
  wsMaxPayloadBytes: {
    min: 65_536, // 64KB
    max: 104_857_600, // 100MB
    label: "WS Max Payload",
    unit: "bytes",
  },
  logRetentionDays: {
    min: 1,
    max: 365,
    label: "Log Retention",
    unit: "days",
  },
  storageMaxDbSizeMb: {
    min: 10,
    max: 50_000, // 50GB
    label: "Max DB Size",
    unit: "MB",
  },
} as const;

type NumericSettingKey = keyof typeof COMMON_SETTINGS_CONSTRAINTS;

interface CommonSettingsValidationResult {
  valid: boolean;
  errors: string[];
  fieldErrors: Record<string, string>;
}

/** Common boot settings that can be edited from dashboard */
export interface BootCommonSettings {
  wsAuthTimeoutMs?: number;
  wsSessionRevalidateIntervalMs?: number;
  wsHeartbeatIntervalMs?: number;
  wsMaxPayloadBytes?: number;
  logFileEnabled?: boolean;
  logRetentionDays?: number;
  acpEnableFsWrite?: boolean;
  acpEnableTerminal?: boolean;
  storageMaxDbSizeMb?: number;
  authAllowSignup?: boolean;
}

export interface BootAllowlistsSnapshot {
  mode: BootRuntimeMode;
  sourcePath?: string;
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedTerminalCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  warnings: string[];
  /** Common boot settings editable from dashboard */
  commonSettings: BootCommonSettings;
}

export interface UpdateBootAllowlistsInput {
  allowedAgentCommandPolicies?: CommandPolicy[];
  allowedTerminalCommandPolicies?: CommandPolicy[];
  allowedEnvKeys?: string[];
  /** Common boot settings to update */
  commonSettings?: Partial<BootCommonSettings>;
}

interface ParsedBootDocument {
  sourcePath: string;
  root: Record<string, unknown>;
  hasBootSection: boolean;
  values: Record<string, unknown>;
}

function cloneCommandPolicies(policies: CommandPolicy[]): CommandPolicy[] {
  return policies.map((policy) => ({
    command: policy.command,
    allowAnyArgs: policy.allowAnyArgs,
    allowedArgs: policy.allowedArgs ? [...policy.allowedArgs] : undefined,
    allowedArgPatterns: policy.allowedArgPatterns
      ? [...policy.allowedArgPatterns]
      : undefined,
  }));
}

function cloneEnvKeys(keys: string[]): string[] {
  return [...keys];
}

function parseNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function validateNumericSetting(
  key: NumericSettingKey,
  value: number | undefined,
  fieldErrors: Record<string, string>,
  errors: string[]
): void {
  if (value === undefined) {
    return;
  }
  const constraint = COMMON_SETTINGS_CONSTRAINTS[key];
  if (!Number.isInteger(value)) {
    const msg = `${constraint.label} must be an integer.`;
    fieldErrors[key] = msg;
    errors.push(msg);
    return;
  }
  if (value < constraint.min) {
    const msg = `${constraint.label} must be at least ${constraint.min.toLocaleString()} ${constraint.unit}.`;
    fieldErrors[key] = msg;
    errors.push(msg);
    return;
  }
  if (value > constraint.max) {
    const msg = `${constraint.label} must be at most ${constraint.max.toLocaleString()} ${constraint.unit}.`;
    fieldErrors[key] = msg;
    errors.push(msg);
  }
}

function validateCommonSettings(
  settings: Partial<BootCommonSettings>
): CommonSettingsValidationResult {
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};

  // Validate each numeric setting
  validateNumericSetting(
    "wsAuthTimeoutMs",
    settings.wsAuthTimeoutMs,
    fieldErrors,
    errors
  );
  validateNumericSetting(
    "wsSessionRevalidateIntervalMs",
    settings.wsSessionRevalidateIntervalMs,
    fieldErrors,
    errors
  );
  validateNumericSetting(
    "wsHeartbeatIntervalMs",
    settings.wsHeartbeatIntervalMs,
    fieldErrors,
    errors
  );
  validateNumericSetting(
    "wsMaxPayloadBytes",
    settings.wsMaxPayloadBytes,
    fieldErrors,
    errors
  );
  validateNumericSetting(
    "logRetentionDays",
    settings.logRetentionDays,
    fieldErrors,
    errors
  );
  validateNumericSetting(
    "storageMaxDbSizeMb",
    settings.storageMaxDbSizeMb,
    fieldErrors,
    errors
  );

  // Cross-field validations
  if (
    settings.wsHeartbeatIntervalMs !== undefined &&
    settings.wsSessionRevalidateIntervalMs !== undefined &&
    settings.wsHeartbeatIntervalMs >= settings.wsSessionRevalidateIntervalMs
  ) {
    const msg =
      "WS Heartbeat Interval must be less than WS Session Revalidate Interval.";
    fieldErrors.wsHeartbeatIntervalMs = msg;
    errors.push(msg);
  }

  if (
    settings.wsAuthTimeoutMs !== undefined &&
    settings.wsHeartbeatIntervalMs !== undefined &&
    settings.wsAuthTimeoutMs > settings.wsHeartbeatIntervalMs
  ) {
    const msg =
      "WS Auth Timeout should not exceed WS Heartbeat Interval for optimal connection handling.";
    // This is a warning, not a hard error - don't add to fieldErrors
    errors.push(`⚠️ Warning: ${msg}`);
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    errors,
    fieldErrors,
  };
}

function extractCommonSettings(
  values: Record<string, unknown>
): BootCommonSettings {
  return {
    wsAuthTimeoutMs: parseNumberValue(
      values[COMMON_BOOT_KEYS.WS_AUTH_TIMEOUT_MS]
    ),
    wsSessionRevalidateIntervalMs: parseNumberValue(
      values[COMMON_BOOT_KEYS.WS_SESSION_REVALIDATE_INTERVAL_MS]
    ),
    wsHeartbeatIntervalMs: parseNumberValue(
      values[COMMON_BOOT_KEYS.WS_HEARTBEAT_INTERVAL_MS]
    ),
    wsMaxPayloadBytes: parseNumberValue(
      values[COMMON_BOOT_KEYS.WS_MAX_PAYLOAD_BYTES]
    ),
    logFileEnabled: parseBooleanValue(
      values[COMMON_BOOT_KEYS.LOG_FILE_ENABLED]
    ),
    logRetentionDays: parseNumberValue(
      values[COMMON_BOOT_KEYS.LOG_RETENTION_DAYS]
    ),
    acpEnableFsWrite: parseBooleanValue(
      values[COMMON_BOOT_KEYS.ACP_ENABLE_FS_WRITE]
    ),
    acpEnableTerminal: parseBooleanValue(
      values[COMMON_BOOT_KEYS.ACP_ENABLE_TERMINAL]
    ),
    storageMaxDbSizeMb: parseNumberValue(
      values[COMMON_BOOT_KEYS.STORAGE_MAX_DB_SIZE_MB]
    ),
    authAllowSignup: parseBooleanValue(
      values[COMMON_BOOT_KEYS.AUTH_ALLOW_SIGNUP]
    ),
  };
}

function applyCommonSettingsToBootValues(
  bootValues: Record<string, unknown>,
  commonSettings: Partial<BootCommonSettings>
): void {
  if (commonSettings.wsAuthTimeoutMs !== undefined) {
    bootValues[COMMON_BOOT_KEYS.WS_AUTH_TIMEOUT_MS] =
      commonSettings.wsAuthTimeoutMs;
  }
  if (commonSettings.wsSessionRevalidateIntervalMs !== undefined) {
    bootValues[COMMON_BOOT_KEYS.WS_SESSION_REVALIDATE_INTERVAL_MS] =
      commonSettings.wsSessionRevalidateIntervalMs;
  }
  if (commonSettings.wsHeartbeatIntervalMs !== undefined) {
    bootValues[COMMON_BOOT_KEYS.WS_HEARTBEAT_INTERVAL_MS] =
      commonSettings.wsHeartbeatIntervalMs;
  }
  if (commonSettings.wsMaxPayloadBytes !== undefined) {
    bootValues[COMMON_BOOT_KEYS.WS_MAX_PAYLOAD_BYTES] =
      commonSettings.wsMaxPayloadBytes;
  }
  if (commonSettings.logFileEnabled !== undefined) {
    bootValues[COMMON_BOOT_KEYS.LOG_FILE_ENABLED] =
      commonSettings.logFileEnabled;
  }
  if (commonSettings.logRetentionDays !== undefined) {
    bootValues[COMMON_BOOT_KEYS.LOG_RETENTION_DAYS] =
      commonSettings.logRetentionDays;
  }
  if (commonSettings.acpEnableFsWrite !== undefined) {
    bootValues[COMMON_BOOT_KEYS.ACP_ENABLE_FS_WRITE] =
      commonSettings.acpEnableFsWrite;
  }
  if (commonSettings.acpEnableTerminal !== undefined) {
    bootValues[COMMON_BOOT_KEYS.ACP_ENABLE_TERMINAL] =
      commonSettings.acpEnableTerminal;
  }
  if (commonSettings.storageMaxDbSizeMb !== undefined) {
    bootValues[COMMON_BOOT_KEYS.STORAGE_MAX_DB_SIZE_MB] =
      commonSettings.storageMaxDbSizeMb;
  }
  if (commonSettings.authAllowSignup !== undefined) {
    bootValues[COMMON_BOOT_KEYS.AUTH_ALLOW_SIGNUP] =
      commonSettings.authAllowSignup;
  }
}

function parseCommandPoliciesValue(
  key: string,
  rawValue: unknown
): CommandPolicy[] {
  const errors: string[] = [];
  const parsed = parseRequiredCommandPolicies(
    key,
    normalizeBootValue(rawValue),
    errors
  );
  if (errors.length > 0) {
    throw new ValidationError(errors.join("\n"), {
      module: "settings",
      op: OP_UPDATE,
      details: { key },
    });
  }
  return parsed;
}

function parseEnvKeysValue(rawValue: unknown): string[] {
  let normalized: string | undefined;
  if (Array.isArray(rawValue)) {
    normalized = rawValue
      .filter((value): value is string => typeof value === "string")
      .join(",");
  } else if (typeof rawValue === "string") {
    normalized = rawValue;
  } else {
    normalized = normalizeBootValue(rawValue);
  }
  const errors: string[] = [];
  const parsed = parseRequiredAllowlist(ENV_KEYS_KEY, normalized, errors);
  if (errors.length > 0) {
    throw new ValidationError(errors.join("\n"), {
      module: "settings",
      op: OP_UPDATE,
      details: { key: ENV_KEYS_KEY },
    });
  }
  return parsed;
}

function normalizeUpdateInput(rawInput: unknown): UpdateBootAllowlistsInput {
  if (!isRecord(rawInput)) {
    throw new ValidationError("Boot allowlist payload must be an object.", {
      module: "settings",
      op: OP_UPDATE,
    });
  }

  const result: UpdateBootAllowlistsInput = {};

  const allowedAgentCommandPolicies =
    rawInput.allowedAgentCommandPolicies ?? rawInput[AGENT_POLICIES_KEY];
  if (allowedAgentCommandPolicies !== undefined) {
    result.allowedAgentCommandPolicies = parseCommandPoliciesValue(
      AGENT_POLICIES_KEY,
      allowedAgentCommandPolicies
    );
  }

  const allowedTerminalCommandPolicies =
    rawInput.allowedTerminalCommandPolicies ?? rawInput[TERMINAL_POLICIES_KEY];
  if (allowedTerminalCommandPolicies !== undefined) {
    result.allowedTerminalCommandPolicies = parseCommandPoliciesValue(
      TERMINAL_POLICIES_KEY,
      allowedTerminalCommandPolicies
    );
  }

  const allowedEnvKeys = rawInput.allowedEnvKeys ?? rawInput[ENV_KEYS_KEY];
  if (allowedEnvKeys !== undefined) {
    result.allowedEnvKeys = parseEnvKeysValue(allowedEnvKeys);
  }

  if (isRecord(rawInput.commonSettings)) {
    const parsedCommonSettings: Partial<BootCommonSettings> = {
      wsAuthTimeoutMs: parseNumberValue(
        rawInput.commonSettings.wsAuthTimeoutMs
      ),
      wsSessionRevalidateIntervalMs: parseNumberValue(
        rawInput.commonSettings.wsSessionRevalidateIntervalMs
      ),
      wsHeartbeatIntervalMs: parseNumberValue(
        rawInput.commonSettings.wsHeartbeatIntervalMs
      ),
      wsMaxPayloadBytes: parseNumberValue(
        rawInput.commonSettings.wsMaxPayloadBytes
      ),
      logFileEnabled: parseBooleanValue(rawInput.commonSettings.logFileEnabled),
      logRetentionDays: parseNumberValue(
        rawInput.commonSettings.logRetentionDays
      ),
      acpEnableFsWrite: parseBooleanValue(
        rawInput.commonSettings.acpEnableFsWrite
      ),
      acpEnableTerminal: parseBooleanValue(
        rawInput.commonSettings.acpEnableTerminal
      ),
      storageMaxDbSizeMb: parseNumberValue(
        rawInput.commonSettings.storageMaxDbSizeMb
      ),
      authAllowSignup: parseBooleanValue(
        rawInput.commonSettings.authAllowSignup
      ),
    };

    // Validate common settings
    const validation = validateCommonSettings(parsedCommonSettings);
    if (!validation.valid) {
      throw new ValidationError(
        `Common settings validation failed:\n${validation.errors.join("\n")}`,
        {
          module: "settings",
          op: OP_UPDATE,
          details: { fieldErrors: validation.fieldErrors },
        }
      );
    }

    result.commonSettings = parsedCommonSettings;
  }

  return result;
}

function resolveWritableBootConfigPath(sourcePath?: string): string {
  if (sourcePath) {
    return sourcePath;
  }
  const explicit = process.env[BOOT_CONFIG_PATH_ENV_KEY]?.trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(process.cwd(), explicit);
  }
  return path.resolve(process.cwd(), BOOT_CONFIG_FILE_NAME);
}

function parseBootConfigFromRawJson(
  rawContent: string,
  sourcePath: string
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new ValidationError(
      `[Boot config] Failed to parse JSON at ${sourcePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        module: "settings",
        op: OP_UPDATE,
        details: { sourcePath },
      }
    );
  }
  if (!isRecord(parsed)) {
    throw new ValidationError(
      `[Boot config] File must contain a JSON object: ${sourcePath}`,
      {
        module: "settings",
        op: OP_UPDATE,
        details: { sourcePath },
      }
    );
  }
  return parsed;
}

async function readBootDocumentForWrite(
  sourcePath?: string
): Promise<ParsedBootDocument> {
  const loaded = loadBootConfigValues();
  const resolvedPath = resolveWritableBootConfigPath(
    sourcePath ?? loaded.sourcePath
  );
  let root: Record<string, unknown> = {};

  if (existsSync(resolvedPath)) {
    const rawContent = await readFile(resolvedPath, "utf8");
    root = parseBootConfigFromRawJson(rawContent, resolvedPath);
  }

  const bootCandidate = root.boot;
  const hasBootSection = isRecord(bootCandidate);
  const values = hasBootSection ? bootCandidate : root;
  if (!isRecord(values)) {
    throw new ValidationError(
      `[Boot config] Boot section at ${resolvedPath} must be an object.`,
      {
        module: "settings",
        op: OP_UPDATE,
        details: { sourcePath: resolvedPath },
      }
    );
  }

  return {
    sourcePath: resolvedPath,
    root,
    hasBootSection,
    values,
  };
}

function parseBootCommandPoliciesWithFallback(params: {
  key: string;
  value: unknown;
  fallback: CommandPolicy[];
  warnings: string[];
}): CommandPolicy[] {
  const { key, value, fallback, warnings } = params;
  const errors: string[] = [];
  const parsed = parseRequiredCommandPolicies(
    key,
    normalizeBootValue(value),
    errors
  );
  if (errors.length === 0) {
    return parsed;
  }
  warnings.push(
    ...errors.map((message) => `${message} Falling back to runtime ENV.`)
  );
  return cloneCommandPolicies(fallback);
}

function parseBootEnvKeysWithFallback(params: {
  value: unknown;
  fallback: string[];
  warnings: string[];
}): string[] {
  const { value, fallback, warnings } = params;
  let normalized: string | undefined;
  if (Array.isArray(value)) {
    normalized = value
      .filter((item): item is string => typeof item === "string")
      .join(",");
  } else if (typeof value === "string") {
    normalized = value;
  } else {
    normalized = normalizeBootValue(value);
  }
  const errors: string[] = [];
  const parsed = parseRequiredAllowlist(ENV_KEYS_KEY, normalized, errors);
  if (errors.length === 0) {
    return parsed;
  }
  warnings.push(
    ...errors.map((message) => `${message} Falling back to runtime ENV.`)
  );
  return cloneEnvKeys(fallback);
}

export class ManageBootAllowlistsService {
  private readonly eventBus: EventBusPort;
  private readonly agentRuntime: AgentRuntimePort;

  constructor(eventBus: EventBusPort, agentRuntime: AgentRuntimePort) {
    this.eventBus = eventBus;
    this.agentRuntime = agentRuntime;
  }

  get(): BootAllowlistsSnapshot {
    const loaded = loadBootConfigValues();
    const warnings: string[] = [];
    return {
      mode: loaded.mode,
      sourcePath: loaded.sourcePath,
      allowedAgentCommandPolicies: parseBootCommandPoliciesWithFallback({
        key: AGENT_POLICIES_KEY,
        value: loaded.values[AGENT_POLICIES_KEY],
        fallback: ENV.allowedAgentCommandPolicies,
        warnings,
      }),
      allowedTerminalCommandPolicies: parseBootCommandPoliciesWithFallback({
        key: TERMINAL_POLICIES_KEY,
        value: loaded.values[TERMINAL_POLICIES_KEY],
        fallback: ENV.allowedTerminalCommandPolicies,
        warnings,
      }),
      allowedEnvKeys: parseBootEnvKeysWithFallback({
        value: loaded.values[ENV_KEYS_KEY],
        fallback: ENV.allowedEnvKeys,
        warnings,
      }),
      commonSettings: extractCommonSettings(loaded.values),
      warnings,
    };
  }

  private applyRuntimeConfig(next: UpdateBootAllowlistsInput): void {
    if (next.allowedAgentCommandPolicies) {
      ENV.allowedAgentCommandPolicies = cloneCommandPolicies(
        next.allowedAgentCommandPolicies
      );
      ENV.allowedAgentCommands = [
        ...new Set(
          next.allowedAgentCommandPolicies.map((entry) => entry.command)
        ),
      ];
    }
    if (next.allowedTerminalCommandPolicies) {
      ENV.allowedTerminalCommandPolicies = cloneCommandPolicies(
        next.allowedTerminalCommandPolicies
      );
      ENV.allowedTerminalCommands = [
        ...new Set(
          next.allowedTerminalCommandPolicies.map((entry) => entry.command)
        ),
      ];
    }
    if (next.allowedEnvKeys) {
      ENV.allowedEnvKeys = cloneEnvKeys(next.allowedEnvKeys);
    }

    // Apply ACP toggles immediately to runtime
    if (next.commonSettings?.acpEnableFsWrite !== undefined) {
      ENV.acpEnableFsWrite = next.commonSettings.acpEnableFsWrite;
    }
    if (next.commonSettings?.acpEnableTerminal !== undefined) {
      ENV.acpEnableTerminal = next.commonSettings.acpEnableTerminal;
    }

    if (next.allowedAgentCommandPolicies || next.allowedEnvKeys) {
      this.agentRuntime.updateInvocationPolicy?.({
        allowedAgentCommandPolicies:
          next.allowedAgentCommandPolicies ?? ENV.allowedAgentCommandPolicies,
        allowedEnvKeys: next.allowedEnvKeys ?? ENV.allowedEnvKeys,
      });
    }
  }

  async update(rawInput: unknown): Promise<BootAllowlistsSnapshot> {
    const next = normalizeUpdateInput(rawInput);
    const bootDocument = await readBootDocumentForWrite();
    const changedKeys: string[] = [];
    const requiresRestart: string[] = [];

    // Update command policies if provided
    if (next.allowedAgentCommandPolicies) {
      bootDocument.values[AGENT_POLICIES_KEY] = cloneCommandPolicies(
        next.allowedAgentCommandPolicies
      );
      changedKeys.push(AGENT_POLICIES_KEY);
    }
    if (next.allowedTerminalCommandPolicies) {
      bootDocument.values[TERMINAL_POLICIES_KEY] = cloneCommandPolicies(
        next.allowedTerminalCommandPolicies
      );
      changedKeys.push(TERMINAL_POLICIES_KEY);
    }
    if (next.allowedEnvKeys) {
      bootDocument.values[ENV_KEYS_KEY] = cloneEnvKeys(next.allowedEnvKeys);
      changedKeys.push(ENV_KEYS_KEY);
    }

    // Update common settings if provided
    if (next.commonSettings) {
      applyCommonSettingsToBootValues(bootDocument.values, next.commonSettings);
      // Track which settings require restart
      const restartOnlyKeys = [
        "wsAuthTimeoutMs",
        "wsSessionRevalidateIntervalMs",
        "wsHeartbeatIntervalMs",
        "wsMaxPayloadBytes",
        "storageMaxDbSizeMb",
        "logFileEnabled",
        "logRetentionDays",
        "authAllowSignup",
      ] as const;
      for (const key of restartOnlyKeys) {
        if (next.commonSettings[key] !== undefined) {
          requiresRestart.push(key);
          changedKeys.push(key);
        }
      }
      // ACP toggles take effect immediately
      if (next.commonSettings.acpEnableFsWrite !== undefined) {
        changedKeys.push("acpEnableFsWrite");
      }
      if (next.commonSettings.acpEnableTerminal !== undefined) {
        changedKeys.push("acpEnableTerminal");
      }
    }

    // Sync boot section with values
    if (bootDocument.hasBootSection && isRecord(bootDocument.root.boot)) {
      bootDocument.root.boot = {
        ...bootDocument.root.boot,
        ...bootDocument.values,
      };
    } else {
      Object.assign(bootDocument.root, bootDocument.values);
    }

    await writeFile(
      bootDocument.sourcePath,
      `${JSON.stringify(bootDocument.root, null, 2)}\n`,
      "utf8"
    );

    this.applyRuntimeConfig(next);

    await this.eventBus.publish({
      type: "settings_updated",
      changedKeys,
      requiresRestart,
    });
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "settings_updated",
    });

    return this.get();
  }
}
