/**
 * ID Utility
 *
 * Generates unique identifiers with optional prefixes for easy debugging.
 *
 * @module shared/utils/id.util
 */

import { randomUUID } from "node:crypto";

/**
 * Creates a unique identifier with a prefix
 *
 * @param prefix - A string prefix to identify the ID type (e.g., 'session', 'project')
 * @returns A unique ID string in format: prefix-uuid
 *
 * @example
 * ```typescript
 * const sessionId = createId('session');
 * // Returns: "session-a38f6f8b-e95b-4b56-90c1-8dbf204f79a8"
 * ```
 */
export function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}
