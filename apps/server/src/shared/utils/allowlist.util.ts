import path from "node:path";

function normalizeAllowlistValue(value: string): string {
  const normalized = path.normalize(value.trim());
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }
  return normalized;
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
