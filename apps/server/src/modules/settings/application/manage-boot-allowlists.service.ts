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

export interface BootAllowlistsSnapshot {
  mode: BootRuntimeMode;
  sourcePath?: string;
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedTerminalCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
  warnings: string[];
}

export interface UpdateBootAllowlistsInput {
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedTerminalCommandPolicies: CommandPolicy[];
  allowedEnvKeys: string[];
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

  const allowedAgentCommandPolicies =
    rawInput.allowedAgentCommandPolicies ?? rawInput[AGENT_POLICIES_KEY];
  const allowedTerminalCommandPolicies =
    rawInput.allowedTerminalCommandPolicies ?? rawInput[TERMINAL_POLICIES_KEY];
  const allowedEnvKeys = rawInput.allowedEnvKeys ?? rawInput[ENV_KEYS_KEY];

  return {
    allowedAgentCommandPolicies: parseCommandPoliciesValue(
      AGENT_POLICIES_KEY,
      allowedAgentCommandPolicies
    ),
    allowedTerminalCommandPolicies: parseCommandPoliciesValue(
      TERMINAL_POLICIES_KEY,
      allowedTerminalCommandPolicies
    ),
    allowedEnvKeys: parseEnvKeysValue(allowedEnvKeys),
  };
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
      warnings,
    };
  }

  private applyRuntimeConfig(next: UpdateBootAllowlistsInput): void {
    ENV.allowedAgentCommandPolicies = cloneCommandPolicies(
      next.allowedAgentCommandPolicies
    );
    ENV.allowedAgentCommands = [
      ...new Set(
        next.allowedAgentCommandPolicies.map((entry) => entry.command)
      ),
    ];
    ENV.allowedTerminalCommandPolicies = cloneCommandPolicies(
      next.allowedTerminalCommandPolicies
    );
    ENV.allowedTerminalCommands = [
      ...new Set(
        next.allowedTerminalCommandPolicies.map((entry) => entry.command)
      ),
    ];
    ENV.allowedEnvKeys = cloneEnvKeys(next.allowedEnvKeys);

    this.agentRuntime.updateInvocationPolicy?.({
      allowedAgentCommandPolicies: next.allowedAgentCommandPolicies,
      allowedEnvKeys: next.allowedEnvKeys,
    });
  }

  async update(rawInput: unknown): Promise<BootAllowlistsSnapshot> {
    const next = normalizeUpdateInput(rawInput);
    const bootDocument = await readBootDocumentForWrite();
    bootDocument.values[AGENT_POLICIES_KEY] = cloneCommandPolicies(
      next.allowedAgentCommandPolicies
    );
    bootDocument.values[TERMINAL_POLICIES_KEY] = cloneCommandPolicies(
      next.allowedTerminalCommandPolicies
    );
    bootDocument.values[ENV_KEYS_KEY] = cloneEnvKeys(next.allowedEnvKeys);

    if (bootDocument.hasBootSection && isRecord(bootDocument.root.boot)) {
      bootDocument.root.boot = {
        ...bootDocument.root.boot,
        [AGENT_POLICIES_KEY]: bootDocument.values[AGENT_POLICIES_KEY],
        [TERMINAL_POLICIES_KEY]: bootDocument.values[TERMINAL_POLICIES_KEY],
        [ENV_KEYS_KEY]: bootDocument.values[ENV_KEYS_KEY],
      };
    } else {
      bootDocument.root[AGENT_POLICIES_KEY] =
        bootDocument.values[AGENT_POLICIES_KEY];
      bootDocument.root[TERMINAL_POLICIES_KEY] =
        bootDocument.values[TERMINAL_POLICIES_KEY];
      bootDocument.root[ENV_KEYS_KEY] = bootDocument.values[ENV_KEYS_KEY];
    }

    await writeFile(
      bootDocument.sourcePath,
      `${JSON.stringify(bootDocument.root, null, 2)}\n`,
      "utf8"
    );

    this.applyRuntimeConfig(next);

    await this.eventBus.publish({
      type: "settings_updated",
      changedKeys: [AGENT_POLICIES_KEY, TERMINAL_POLICIES_KEY, ENV_KEYS_KEY],
      requiresRestart: [],
    });
    await this.eventBus.publish({
      type: "dashboard_refresh",
      reason: "settings_updated",
    });

    return this.get();
  }
}
