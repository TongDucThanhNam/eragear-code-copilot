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
  allowedArgPatterns?: string[];
}

interface CompiledCommandPolicy {
  allowAnyArgs: boolean;
  allowedArgs: Set<string>;
  allowedArgPatterns: RegExp[];
}

export type CommandPolicyRegistry = Map<string, CompiledCommandPolicy>;

const MAX_ALLOWED_ARG_PATTERN_LENGTH = 256;
const REGEX_BACKREFERENCE_PATTERN = /\\[1-9]/;
const REGEX_CONSECUTIVE_QUANTIFIERS_PATTERN =
  /(\*|\+|\?|\{[^}]+\})(\*|\+|\?|\{)/;

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

function assertSafeArgPatternSubset(
  command: string,
  pattern: string,
  index: number
): void {
  if (pattern.length > MAX_ALLOWED_ARG_PATTERN_LENGTH) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} exceeds ${MAX_ALLOWED_ARG_PATTERN_LENGTH} characters`
    );
  }
  if (pattern.includes("|")) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must not include alternation (|)`
    );
  }
  if (pattern.includes("(") || pattern.includes(")")) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must not include grouping constructs`
    );
  }
  if (REGEX_BACKREFERENCE_PATTERN.test(pattern)) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must not include backreferences`
    );
  }
  if (REGEX_CONSECUTIVE_QUANTIFIERS_PATTERN.test(pattern)) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must not include consecutive quantifiers`
    );
  }
}

function assertAbsoluteCommandPath(command: string): void {
  if (!path.isAbsolute(command)) {
    throw new Error(
      `Command policy command must be an absolute path: ${command}`
    );
  }
}

function compileAllowedArgPattern(
  command: string,
  pattern: string,
  index: number
): RegExp {
  const normalizedPattern = normalizeArgToken(pattern);
  if (normalizedPattern.length === 0) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must be a non-empty string`
    );
  }
  if (!(normalizedPattern.startsWith("^") && normalizedPattern.endsWith("$"))) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must be anchored with ^...$`
    );
  }
  assertSafeArgPatternSubset(command, normalizedPattern, index);

  try {
    return new RegExp(normalizedPattern);
  } catch {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} is not a valid regex`
    );
  }
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
    assertAbsoluteCommandPath(policy.command);
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
    const allowedArgPatterns = [
      ...new Set(
        (policy.allowedArgPatterns ?? [])
          .map((entry) => normalizeArgToken(entry))
          .filter((entry) => entry.length > 0)
      ),
    ].map((pattern, index) =>
      compileAllowedArgPattern(normalizedCommand, pattern, index)
    );

    registry.set(normalizedCommand, {
      allowAnyArgs,
      allowedArgs,
      allowedArgPatterns,
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
  if (!path.isAbsolute(command)) {
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
      policy.allowedArgPatterns.some((pattern) => pattern.test(normalizedArg))
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
