/**
 * Transport HTTP Auth Utilities
 *
 * Client-facing auth helpers for HTTP routes.
 * Wraps infra auth logic for the HTTP transport layer.
 *
 * @module transport/http/utils/auth
 */

// biome-ignore lint/style/noRestrictedImports: transport auth helpers intentionally bridge to Better Auth runtime.
import { auth, authState } from "../../../platform/auth/auth";
// biome-ignore lint/style/noRestrictedImports: transport auth helpers intentionally bridge to Better Auth runtime.
import type { SessionUser } from "../../../platform/auth/guards";
// biome-ignore lint/style/noRestrictedImports: transport auth helpers intentionally bridge to Better Auth runtime.
import { getSessionFromRequest as infraGetSessionFromRequest } from "../../../platform/auth/guards";

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
): Promise<{ user: SessionUser; session: unknown } | null> {
  return await infraGetSessionFromRequest(req);
}

export function resolveAdminUsername(defaultUsername: string): string {
  return authState.adminUsername ?? defaultUsername;
}

export async function listApiKeys(headers: Headers): Promise<unknown[]> {
  const keys = await auth.api.listApiKeys({ headers });
  return Array.isArray(keys) ? keys : [];
}

export async function listDeviceSessions(headers: Headers): Promise<unknown[]> {
  const sessions = await auth.api.listDeviceSessions({ headers });
  return Array.isArray(sessions) ? sessions : [];
}
