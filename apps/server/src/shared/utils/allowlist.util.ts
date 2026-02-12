import path from "node:path";

function normalizeAllowlistValue(value: string): string {
  const normalized = path.normalize(value.trim());
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
}

export interface CommandPolicy {
  command: string;
  allowAnyArgs?: boolean;
  allowedArgs?: string[];
  allowedArgPrefixes?: string[];
}

interface CompiledCommandPolicy {
  allowAnyArgs: boolean;
  allowedArgs: Set<string>;
  allowedArgPrefixes: string[];
}

export type CommandPolicyRegistry = Map<string, CompiledCommandPolicy>;

/**
 * Exact command allowlist matcher.
 *
 * Security note:
 * - No basename fallback. `/tmp/node` must not match allowlist entry `node`.
 * - Operators must explicitly allow each executable form they trust.
 */
export function isCommandAllowed(
  command: string,
  allowlist: string[]
): boolean {
  if (allowlist.length === 0) {
    return false;
  }

  const normalizedCommand = normalizeAllowlistValue(command);
  if (normalizedCommand.length === 0) {
    return false;
  }

  const allowed = new Set(
    allowlist
      .map((item) => normalizeAllowlistValue(item))
      .filter((item) => item.length > 0)
  );

  return allowed.has(normalizedCommand);
}

function normalizeArgToken(token: string): string {
  return token.trim();
}

function assertUniqueCommandPolicy(
  registry: CommandPolicyRegistry,
  command: string
): void {
  if (registry.has(command)) {
    throw new Error(`Duplicate command policy for: ${command}`);
  }
}

/**
 * Compiles command/args policies for fast invocation checks.
 */
export function compileCommandPolicies(
  policies: CommandPolicy[]
): CommandPolicyRegistry {
  const registry: CommandPolicyRegistry = new Map();
  for (const policy of policies) {
    const normalizedCommand = normalizeAllowlistValue(policy.command);
    if (normalizedCommand.length === 0) {
      throw new Error("Command policy command must be a non-empty string");
    }
    assertUniqueCommandPolicy(registry, normalizedCommand);

    const allowAnyArgs = policy.allowAnyArgs === true;
    const allowedArgs = new Set(
      (policy.allowedArgs ?? [])
        .map((entry) => normalizeArgToken(entry))
        .filter((entry) => entry.length > 0)
    );
    const allowedArgPrefixes = [
      ...new Set(
        (policy.allowedArgPrefixes ?? [])
          .map((entry) => normalizeArgToken(entry))
          .filter((entry) => entry.length > 0)
      ),
    ];

    registry.set(normalizedCommand, {
      allowAnyArgs,
      allowedArgs,
      allowedArgPrefixes,
    });
  }
  return registry;
}

/**
 * Validates one command invocation against a compiled command policy registry.
 */
export function isCommandInvocationAllowed(
  command: string,
  args: string[],
  policies: CommandPolicyRegistry
): boolean {
  if (policies.size === 0) {
    return false;
  }
  const normalizedCommand = normalizeAllowlistValue(command);
  if (normalizedCommand.length === 0) {
    return false;
  }

  const policy = policies.get(normalizedCommand);
  if (!policy) {
    return false;
  }
  if (policy.allowAnyArgs) {
    return true;
  }

  for (const arg of args) {
    const normalizedArg = normalizeArgToken(arg);
    if (normalizedArg.length === 0) {
      return false;
    }
    if (policy.allowedArgs.has(normalizedArg)) {
      continue;
    }
    if (
      policy.allowedArgPrefixes.some((prefix) =>
        normalizedArg.startsWith(prefix)
      )
    ) {
      continue;
    }
    return false;
  }

  return true;
}

/**
 * Filters env keys by allowlist while dropping undefined values.
 */
export function filterEnvAllowlist(
  env: Record<string, string | undefined>,
  allowlist: string[]
): Record<string, string> {
  if (allowlist.length === 0) {
    return {};
  }

  const filtered: Record<string, string> = {};
  const allowed = new Set(allowlist);

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (!allowed.has(key)) {
      continue;
    }
    filtered[key] = value;
  }

  return filtered;
}
