import type { CommandPolicy } from "@/shared/utils/allowlist.util";
import type { BootRuntimeMode } from "./boot-config.loader";
import {
  DEFAULT_DEV_ALLOWED_AGENT_COMMANDS,
  DEFAULT_DEV_ALLOWED_ENV_KEYS,
  DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS,
} from "./constants";
import {
  parseAllowlistWithFallback,
  parseCommandPoliciesWithLegacyFallback,
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

  const allowedAgentCommandPolicies = strictAllowlist
    ? parseRequiredCommandPolicies(
        "ALLOWED_AGENT_COMMAND_POLICIES",
        input.allowedAgentCommandPoliciesRaw,
        allowlistErrors
      )
    : parseCommandPoliciesWithLegacyFallback({
        policyName: "ALLOWED_AGENT_COMMAND_POLICIES",
        policyValue: input.allowedAgentCommandPoliciesRaw,
        legacyName: "ALLOWED_AGENT_COMMANDS",
        legacyValue: input.allowedAgentCommandsRaw,
        legacyFallback: DEFAULT_DEV_ALLOWED_AGENT_COMMANDS,
        warnings: allowlistWarnings,
      });

  const allowedTerminalCommandPolicies = strictAllowlist
    ? parseRequiredCommandPolicies(
        "ALLOWED_TERMINAL_COMMAND_POLICIES",
        input.allowedTerminalCommandPoliciesRaw,
        allowlistErrors
      )
    : parseCommandPoliciesWithLegacyFallback({
        policyName: "ALLOWED_TERMINAL_COMMAND_POLICIES",
        policyValue: input.allowedTerminalCommandPoliciesRaw,
        legacyName: "ALLOWED_TERMINAL_COMMANDS",
        legacyValue: input.allowedTerminalCommandsRaw,
        legacyFallback: DEFAULT_DEV_ALLOWED_TERMINAL_COMMANDS,
        warnings: allowlistWarnings,
      });

  const allowedEnvKeys = strictAllowlist
    ? parseRequiredAllowlist(
        "ALLOWED_ENV_KEYS",
        input.allowedEnvKeysRaw,
        allowlistErrors
      )
    : parseAllowlistWithFallback(
        "ALLOWED_ENV_KEYS",
        input.allowedEnvKeysRaw,
        DEFAULT_DEV_ALLOWED_ENV_KEYS,
        allowlistWarnings
      );

  if (strictAllowlist && allowlistErrors.length > 0) {
    const bootConfigHint = input.bootSourcePath
      ? `Loaded boot config from: ${input.bootSourcePath}`
      : `No settings.json boot config found. Searched: ${input.bootSearchedPaths.join(", ")}`;
    const configInputHint =
      input.bootMode === "compiled"
        ? 'Compiled mode ignores env var overrides. Configure these in settings.json under "boot".'
        : "You can configure these via env vars or settings.json (boot.ALLOWED_*).";
    throw new Error(
      [
        "[Config] Invalid required allowlist configuration:",
        ...allowlistErrors.map((error) => `- ${error}`),
        'Policy format: ALLOWED_*_COMMAND_POLICIES=\'[{"command":"/usr/local/bin/codex","allowAnyArgs":true}]\'',
        "Legacy format (non-strict only): ALLOWED_*_COMMANDS=item1,item2,item3",
        configInputHint,
        bootConfigHint,
      ].join("\n")
    );
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
