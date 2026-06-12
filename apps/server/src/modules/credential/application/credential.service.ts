import type {
  CredentialListInput,
  CredentialListResult,
  CredentialRecord,
  DeleteCredentialInput,
  DeleteCredentialResult,
  ResolveCredentialSecretInput,
  UpsertCredentialInput,
} from "./contracts/credential.contract";
import type {
  CredentialStorePort,
  ResolvedCredentialSecret,
} from "./ports/credential-store.port";

export class CredentialService {
  private readonly store: CredentialStorePort;

  constructor(store: CredentialStorePort) {
    this.store = store;
  }

  async list(
    userId: string,
    input?: CredentialListInput
  ): Promise<CredentialListResult> {
    return await this.store.list(userId, input);
  }

  async upsert(
    userId: string,
    input: UpsertCredentialInput
  ): Promise<CredentialRecord> {
    return await this.store.upsert(userId, input);
  }

  async delete(
    userId: string,
    input: DeleteCredentialInput
  ): Promise<DeleteCredentialResult> {
    return await this.store.delete(userId, input);
  }

  async resolveSecret(
    userId: string,
    input: ResolveCredentialSecretInput
  ): Promise<ResolvedCredentialSecret | null> {
    return await this.store.resolveSecret(userId, input);
  }
}
