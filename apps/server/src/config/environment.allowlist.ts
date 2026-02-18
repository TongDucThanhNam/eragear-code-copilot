import type { CommandPolicy } from "@/shared/utils/allowlist.util";
import type { BootRuntimeMode } from "./boot-config.loader";
import {
  DEFAULT_DEV_ALLOWED_AGENT_COMMANDS,
  DEFAULT_DEV_ALLOWED_ENV_KEYS,
  DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS,
} from "./constants";
import {
  parseAllowlistWithFallback,
  parseCommandPoliciesWithFallback,
  parseRequiredAllowlist,
  parseRequiredCommandPolicies,
  toBoolean,
} from "./environment.parsers";

interface AllowlistConfigInput {
  bootMode: BootRuntimeMode;
  isProd: boolean;
  allowInsecureDevDefaultsRaw: string | undefined;
  strictAllowlistRaw: string | undefined;
  allowedAgentCommandPoliciesRaw: string | undefined;
  allowedAgentCommandsRaw: string | undefined;
  allowedTerminalCommandPoliciesRaw: string | undefined;
  allowedTerminalCommandsRaw: string | undefined;
  allowedEnvKeysRaw: string | undefined;
  bootSourcePath?: string;
  bootSearchedPaths: string[];
}

export interface AllowlistConfig {
  strictAllowlist: boolean;
  allowInsecureDevDefaults: boolean;
  allowedAgentCommandPolicies: CommandPolicy[];
  allowedTerminalCommandPolicies: CommandPolicy[];
  allowedAgentCommands: string[];
  allowedTerminalCommands: string[];
  allowedEnvKeys: string[];
}

function hasNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function pushLegacyAllowlistDiagnostics(params: {
  strictAllowlist: boolean;
  hasLegacyValue: boolean;
  legacyName: "ALLOWED_AGENT_COMMANDS" | "ALLOWED_TERMINAL_COMMANDS";
  policyName:
    | "ALLOWED_AGENT_COMMAND_POLICIES"
    | "ALLOWED_TERMINAL_COMMAND_POLICIES";
  errors: string[];
  warnings: string[];
}): void {
  if (!params.hasLegacyValue) {
    return;
  }
  if (params.strictAllowlist) {
    params.errors.push(
      `${params.legacyName} is deprecated. Use ${params.policyName}.`
    );
    return;
  }
  params.warnings.push(
    `${params.legacyName} is deprecated and ignored. Use ${params.policyName}.`
  );
}

function parseCommandPoliciesByMode(params: {
  strictAllowlist: boolean;
  policyName:
    | "ALLOWED_AGENT_COMMAND_POLICIES"
    | "ALLOWED_TERMINAL_COMMAND_POLICIES";
  policyValue: string | undefined;
  fallbackCommands: readonly string[];
  errors: string[];
  warnings: string[];
}): CommandPolicy[] {
  if (params.strictAllowlist) {
    return parseRequiredCommandPolicies(
      params.policyName,
      params.policyValue,
      params.errors
    );
  }
  return parseCommandPoliciesWithFallback({
    policyName: params.policyName,
    policyValue: params.policyValue,
    fallbackCommands: params.fallbackCommands,
    warnings: params.warnings,
  });
}

function parseEnvAllowlistByMode(params: {
  strictAllowlist: boolean;
  value: string | undefined;
  errors: string[];
  warnings: string[];
}): string[] {
  if (params.strictAllowlist) {
    return parseRequiredAllowlist(
      "ALLOWED_ENV_KEYS",
      params.value,
      params.errors
    );
  }
  return parseAllowlistWithFallback(
    "ALLOWED_ENV_KEYS",
    params.value,
    DEFAULT_DEV_ALLOWED_ENV_KEYS,
    params.warnings
  );
}

function buildAllowlistErrorMessage(
  input: AllowlistConfigInput,
  errors: string[]
): string {
  const bootConfigHint = input.bootSourcePath
    ? `Loaded boot config from: ${input.bootSourcePath}`
    : `No settings.json boot config found. Searched: ${input.bootSearchedPaths.join(", ")}`;
  const configInputHint =
    input.bootMode === "compiled"
      ? 'Compiled mode ignores env var overrides. Configure these in settings.json under "boot".'
      : "You can configure these via env vars or settings.json (boot.ALLOWED_*).";
  return [
    "[Config] Invalid required allowlist configuration:",
    ...errors.map((error) => `- ${error}`),
    'Policy format: ALLOWED_*_COMMAND_POLICIES=\'[{"command":"/usr/local/bin/codex","allowAnyArgs":true}]\'',
    "Legacy format (non-strict only): ALLOWED_*_COMMANDS=item1,item2,item3",
    configInputHint,
    bootConfigHint,
  ].join("\n");
}

export function resolveAllowlistConfig(
  input: AllowlistConfigInput
): AllowlistConfig {
  const allowInsecureDevDefaults = toBoolean(
    input.allowInsecureDevDefaultsRaw,
    false
  );
  if (allowInsecureDevDefaults && input.isProd) {
    throw new Error(
      "[Config] ALLOW_INSECURE_DEV_DEFAULTS must be false in production runtime."
    );
  }

  const strictAllowlistRequested = toBoolean(input.strictAllowlistRaw, true);
  if (!(strictAllowlistRequested || allowInsecureDevDefaults)) {
    throw new Error(
      "[Config] CONFIG_STRICT_ALLOWLIST=false requires ALLOW_INSECURE_DEV_DEFAULTS=true (development-only)."
    );
  }

  const strictAllowlist =
    input.bootMode === "compiled" ? true : !allowInsecureDevDefaults;
  const allowlistErrors: string[] = [];
  const allowlistWarnings: string[] = [];
  pushLegacyAllowlistDiagnostics({
    strictAllowlist,
    hasLegacyValue: hasNonEmpty(input.allowedAgentCommandsRaw),
    legacyName: "ALLOWED_AGENT_COMMANDS",
    policyName: "ALLOWED_AGENT_COMMAND_POLICIES",
    errors: allowlistErrors,
    warnings: allowlistWarnings,
  });
  pushLegacyAllowlistDiagnostics({
    strictAllowlist,
    hasLegacyValue: hasNonEmpty(input.allowedTerminalCommandsRaw),
    legacyName: "ALLOWED_TERMINAL_COMMANDS",
    policyName: "ALLOWED_TERMINAL_COMMAND_POLICIES",
    errors: allowlistErrors,
    warnings: allowlistWarnings,
  });

  const allowedAgentCommandPolicies = parseCommandPoliciesByMode({
    strictAllowlist,
    policyName: "ALLOWED_AGENT_COMMAND_POLICIES",
    policyValue: input.allowedAgentCommandPoliciesRaw,
    fallbackCommands: DEFAULT_DEV_ALLOWED_AGENT_COMMANDS,
    errors: allowlistErrors,
    warnings: allowlistWarnings,
  });

  const allowedTerminalCommandPolicies = parseCommandPoliciesByMode({
    strictAllowlist,
    policyName: "ALLOWED_TERMINAL_COMMAND_POLICIES",
    policyValue: input.allowedTerminalCommandPoliciesRaw,
    fallbackCommands: DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS,
    errors: allowlistErrors,
    warnings: allowlistWarnings,
  });

  const allowedEnvKeys = parseEnvAllowlistByMode({
    strictAllowlist,
    value: input.allowedEnvKeysRaw,
    errors: allowlistErrors,
    warnings: allowlistWarnings,
  });

  if (strictAllowlist && allowlistErrors.length > 0) {
    throw new Error(buildAllowlistErrorMessage(input, allowlistErrors));
  }

  if (!strictAllowlist && allowlistWarnings.length > 0) {
    for (const warning of allowlistWarnings) {
      console.warn(`[Config] ${warning}`);
    }
  }

  return {
    strictAllowlist,
    allowInsecureDevDefaults,
    allowedAgentCommandPolicies,
    allowedTerminalCommandPolicies,
    allowedAgentCommands: [
      ...new Set(allowedAgentCommandPolicies.map((policy) => policy.command)),
    ],
    allowedTerminalCommands: [
      ...new Set(
        allowedTerminalCommandPolicies.map((policy) => policy.command)
      ),
    ],
    allowedEnvKeys,
  };
}
