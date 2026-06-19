import type { CredentialRecord } from "../contracts/credential.contract";

export interface ResolvedCredentialSecret {
  credential: CredentialRecord;
  secret: string;
}

export interface StoredCredential extends CredentialRecord {
  secret: string;
}

export interface CredentialStorePort {
  read<T>(
    reader: (credentials: readonly StoredCredential[]) => T | Promise<T>
  ): Promise<T>;
  mutate<T>(
    mutator: (credentials: StoredCredential[]) => T | Promise<T>
  ): Promise<T>;
}
