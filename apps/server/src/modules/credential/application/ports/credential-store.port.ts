import type {
  CredentialListInput,
  CredentialListResult,
  CredentialRecord,
  DeleteCredentialInput,
  DeleteCredentialResult,
  ResolveCredentialSecretInput,
  UpsertCredentialInput,
} from "../contracts/credential.contract";

export interface ResolvedCredentialSecret {
  credential: CredentialRecord;
  secret: string;
}

export interface CredentialStorePort {
  list(
    userId: string,
    input?: CredentialListInput
  ): Promise<CredentialListResult>;
  upsert(
    userId: string,
    input: UpsertCredentialInput
  ): Promise<CredentialRecord>;
  delete(
    userId: string,
    input: DeleteCredentialInput
  ): Promise<DeleteCredentialResult>;
  resolveSecret(
    userId: string,
    input: ResolveCredentialSecretInput
  ): Promise<ResolvedCredentialSecret | null>;
}
