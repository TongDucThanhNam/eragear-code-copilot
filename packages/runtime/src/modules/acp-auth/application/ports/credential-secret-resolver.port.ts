import type {
  CredentialKind,
  CredentialRecord,
} from "#runtime/modules/credential";

export interface ResolvedAcpCredentialSecret {
  credential: CredentialRecord;
  secret: string;
}

export interface CredentialSecretResolverPort {
  resolveSecret(
    userId: string,
    input: {
      id?: string;
      providerId?: string;
      kind?: CredentialKind;
    }
  ): Promise<ResolvedAcpCredentialSecret | null>;
}
