/**
 * Minimal authenticated user projection returned to application services.
 *
 * Invariant: nullable display fields are normalized by the caller-facing
 * use-case, not by this port.
 */
export interface AuthUserRecord {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  image: string | null;
}

/**
 * Read-only auth user lookup port.
 *
 * Caller contract: `null` means the authenticated subject no longer exists or
 * cannot be read; services should not synthesize authorization from this port.
 */
export interface AuthUserReadPort {
  findById(userId: string): Promise<AuthUserRecord | null>;
}
