/**
 * Path Utility
 *
 * Utilities for working with file URIs and paths.
 *
 * @module shared/utils/path.util
 */

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
  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.replace("file://", ""));
  }
  return uri;
}
