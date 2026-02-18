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
  allowedArgPatterns: string[];
}

export type CommandPolicyRegistry = Map<string, CompiledCommandPolicy>;

const MAX_ALLOWED_ARG_PATTERN_LENGTH = 256;
const MAX_COMMAND_ARG_LENGTH = 2048;
const MAX_ALLOWED_ARG_PATTERNS_PER_COMMAND = 64;
const MAX_ALLOWED_ARGS_PER_COMMAND = 256;
const MAX_WILDCARDS_PER_PATTERN = 64;
const SAFE_PATTERN_CHARSET = /^[A-Za-z0-9_ ./:=@,%+\-*?]+$/;

/**
 * Deterministic wildcard matcher supporting `*` and `?` only.
 *
 * - `*` matches any run of characters (including empty).
 * - `?` matches one character.
 */
function wildcardMatch(pattern: string, input: string): boolean {
  let p = 0;
  let s = 0;
  let starIdx = -1;
  let matchIdx = 0;

  while (s < input.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === input[s])) {
      p += 1;
      s += 1;
      continue;
    }
    if (p < pattern.length && pattern[p] === "*") {
      starIdx = p;
      matchIdx = s;
      p += 1;
      continue;
    }
    if (starIdx !== -1) {
      p = starIdx + 1;
      matchIdx += 1;
      s = matchIdx;
      continue;
    }
    return false;
  }

  while (p < pattern.length && pattern[p] === "*") {
    p += 1;
  }

  return p === pattern.length;
}

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

function assertSafeArgPattern(command: string, pattern: string, index: number): void {
  if (pattern.length > MAX_ALLOWED_ARG_PATTERN_LENGTH) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} exceeds ${MAX_ALLOWED_ARG_PATTERN_LENGTH} characters`
    );
  }
  if (!SAFE_PATTERN_CHARSET.test(pattern)) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must only use supported wildcard tokens (*, ?) and safe characters`
    );
  }
  const wildcardCount = [...pattern].filter(
    (token) => token === "*" || token === "?"
  ).length;
  if (wildcardCount > MAX_WILDCARDS_PER_PATTERN) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} exceeds ${MAX_WILDCARDS_PER_PATTERN} wildcard tokens`
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
): string {
  const normalizedPattern = normalizeArgToken(pattern);
  if (normalizedPattern.length === 0) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must be a non-empty string`
    );
  }

  // Backward compatibility: strip legacy ^...$ anchors if present.
  const wildcardPattern =
    normalizedPattern.startsWith("^") && normalizedPattern.endsWith("$")
      ? normalizedPattern.slice(1, -1)
      : normalizedPattern;

  if (wildcardPattern.length === 0) {
    throw new Error(
      `Allowed arg pattern for ${command} at index ${index} must be non-empty after normalization`
    );
  }
  assertSafeArgPattern(command, wildcardPattern, index);

  return wildcardPattern;
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
    if ((policy.allowedArgs?.length ?? 0) > MAX_ALLOWED_ARGS_PER_COMMAND) {
      throw new Error(
        `Allowed args for ${normalizedCommand} exceed ${MAX_ALLOWED_ARGS_PER_COMMAND} entries`
      );
    }
    if (
      (policy.allowedArgPatterns?.length ?? 0) >
      MAX_ALLOWED_ARG_PATTERNS_PER_COMMAND
    ) {
      throw new Error(
        `Allowed arg patterns for ${normalizedCommand} exceed ${MAX_ALLOWED_ARG_PATTERNS_PER_COMMAND} entries`
      );
    }
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
    if (normalizedArg.length > MAX_COMMAND_ARG_LENGTH) {
      return false;
    }
    if (policy.allowedArgs.has(normalizedArg)) {
      continue;
    }
    if (
      policy.allowedArgPatterns.some((pattern) =>
        wildcardMatch(pattern, normalizedArg)
      )
    ) {
      continue;
    }
    return false;
  }

  return true;
}

/**
 * Filters env vars to allowed keys only.
 */
export function filterEnvAllowlist(
  sourceEnv: Record<string, string | undefined>,
  allowedKeys: string[]
): Record<string, string> {
  if (allowedKeys.length === 0) {
    return {};
  }

  const result: Record<string, string> = {};
  const keySet = new Set(
    allowedKeys.map((key) => key.trim()).filter((key) => key.length > 0)
  );

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (!keySet.has(key)) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    result[key] = value;
  }

  return result;
}
