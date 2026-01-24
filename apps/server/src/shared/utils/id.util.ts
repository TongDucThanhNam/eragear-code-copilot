/**
 * ID Utility
 *
 * Generates unique identifiers with optional prefixes for easy debugging.
 *
 * @module shared/utils/id.util
 */

/**
 * Creates a unique identifier with a prefix
 *
 * @param prefix - A string prefix to identify the ID type (e.g., 'session', 'project')
 * @returns A unique ID string in format: prefix-timestamp-random
 *
 * @example
 * ```typescript
 * const sessionId = createId('session');
 * // Returns: "session-1701234567890-abc123def456"
 * ```
 */
export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
