/**
 * Path Utility
 *
 * Utilities for working with file URIs and paths.
 *
 * @module shared/utils/path.util
 */

import { fileURLToPath } from "node:url";

const FILE_URI_SCHEME_RE = /^file:/i;
const FILE_URI_ABSOLUTE_RE = /^file:(\/\/|\/)/i;

function throwInvalidFileUri(uri: string, reason: string): never {
  throw new Error(`Invalid file URI: ${uri}. ${reason}`);
}

function parseFileUri(uri: string): URL {
  if (!FILE_URI_ABSOLUTE_RE.test(uri)) {
    throwInvalidFileUri(
      uri,
      "File URI must be absolute and start with file:/ or file://."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throwInvalidFileUri(uri, message);
  }

  if (parsed.protocol !== "file:") {
    throwInvalidFileUri(uri, "URI scheme must be file:");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throwInvalidFileUri(uri, "Credentials are not allowed in file URIs.");
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throwInvalidFileUri(
      uri,
      "Query parameters and fragments are not allowed in file URIs."
    );
  }
  if (
    parsed.hostname.length > 0 &&
    parsed.hostname.toLowerCase() !== "localhost"
  ) {
    throwInvalidFileUri(
      uri,
      "Remote file URI hosts are not allowed; use a local absolute file URI."
    );
  }

  return parsed;
}

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
  if (!FILE_URI_SCHEME_RE.test(uri)) {
    return uri;
  }

  if (uri.trim() !== uri) {
    throwInvalidFileUri(
      uri,
      "URI must not contain leading or trailing spaces."
    );
  }

  const parsed = parseFileUri(uri);
  try {
    return fileURLToPath(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throwInvalidFileUri(uri, message);
  }
}
