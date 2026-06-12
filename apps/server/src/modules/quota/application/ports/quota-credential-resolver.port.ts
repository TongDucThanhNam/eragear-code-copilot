export type QuotaCredentialKind =
  | "api_key"
  | "bearer_token"
  | "oauth_token"
  | "secret";

export interface ResolveQuotaCredentialInput {
  providerIds: readonly string[];
  names?: readonly string[];
  kinds?: readonly QuotaCredentialKind[];
}

export interface ResolvedQuotaCredentialSecret {
  credentialId: string;
  providerId?: string;
  name: string;
  kind: QuotaCredentialKind;
  secret: string;
}

/**
 * Resolves app-stored encrypted credentials for provider quota checks.
 *
 * Security invariant: implementations may return the raw secret only to the
 * quota adapter making the remote provider request; snapshots/events must not
 * expose it.
 */
export interface QuotaCredentialResolverPort {
  resolveFirst(
    userId: string,
    input: ResolveQuotaCredentialInput
  ): Promise<ResolvedQuotaCredentialSecret | null>;
}
