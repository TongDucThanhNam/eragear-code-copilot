/**
 * Path Utility
 *
 * Utilities for working with file URIs and paths.
 *
 * @module shared/utils/path.util
 */

import { fileURLToPath } from "node:url";

/**
 * Converts a file URI to a filesystem path
 *
 * @param uri - The file URI (e.g., 'file:///home/user/file.txt')
 * @returns The decoded filesystem path
 *
 * @example
 * ```typescript
 * const path = fileUriToPath('file:///home/user/file.txt');
 * // Returns: '/home/user/file.txt'
 * ```
 */
export function fileUriToPath(uri: string) {
  if (!uri.startsWith("file://")) {
    return uri;
  }

  try {
    return fileURLToPath(uri);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid file URI: ${uri}. ${message}`);
  }
}
