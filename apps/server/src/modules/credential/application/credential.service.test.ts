import { describe, expect, test } from "bun:test";
import type {
  CredentialListInput,
  CredentialListResult,
  CredentialRecord,
  DeleteCredentialInput,
  DeleteCredentialResult,
  ResolveCredentialSecretInput,
  UpsertCredentialInput,
} from "./contracts/credential.contract";
import { CredentialService } from "./credential.service";
import type {
  CredentialStorePort,
  ResolvedCredentialSecret,
} from "./ports/credential-store.port";

class CredentialStoreStub implements CredentialStorePort {
  readonly calls: string[] = [];
  record: CredentialRecord = {
    id: "cred-1",
    userId: "user-1",
    name: "OpenAI",
    kind: "api_key",
    providerId: "openai",
    secretPreview: "****1234",
    createdAt: 1,
    updatedAt: 1,
    secretUpdatedAt: 1,
  };

  list(
    _userId: string,
    _input?: CredentialListInput
  ): Promise<CredentialListResult> {
    this.calls.push("list");
    return Promise.resolve({ credentials: [this.record], totalCount: 1 });
  }

  upsert(
    _userId: string,
    _input: UpsertCredentialInput
  ): Promise<CredentialRecord> {
    this.calls.push("upsert");
    return Promise.resolve(this.record);
  }

  delete(
    _userId: string,
    _input: DeleteCredentialInput
  ): Promise<DeleteCredentialResult> {
    this.calls.push("delete");
    return Promise.resolve({ deleted: true });
  }

  resolveSecret(
    _userId: string,
    _input: ResolveCredentialSecretInput
  ): Promise<ResolvedCredentialSecret | null> {
    this.calls.push("resolveSecret");
    return Promise.resolve({ credential: this.record, secret: "secret-value" });
  }
}

describe("CredentialService", () => {
  test("delegates credential management to the store port", async () => {
    const store = new CredentialStoreStub();
    const service = new CredentialService(store);

    await service.list("user-1");
    await service.upsert("user-1", {
      name: "OpenAI",
      kind: "api_key",
      providerId: "openai",
      secret: "sk-test",
    });
    await service.delete("user-1", { id: "cred-1" });
    const resolved = await service.resolveSecret("user-1", { id: "cred-1" });

    expect(store.calls).toEqual(["list", "upsert", "delete", "resolveSecret"]);
    expect(resolved?.secret).toBe("secret-value");
  });
});
