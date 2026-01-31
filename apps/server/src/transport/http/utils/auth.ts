/**
 * Transport HTTP Auth Utilities
 *
 * Client-facing auth helpers for HTTP routes.
 * Wraps infra auth logic for the HTTP transport layer.
 *
 * @module transport/http/utils/auth
 */

import { getSessionFromRequest as infraGetSessionFromRequest } from "../../../infra/auth/guards";

type HeaderRecord = Record<string, string | string[] | undefined>;

interface RequestLike {
  headers: Headers | HeaderRecord;
  url?: string;
}

/**
 * Get session from HTTP request
 * @param req - Request-like object with headers and URL
 * @returns User and session info or null if not authenticated
 */
export async function getSessionFromRequest(
  req: RequestLike
): Promise<{ user: unknown; session: unknown } | null> {
  return infraGetSessionFromRequest(req);
}
