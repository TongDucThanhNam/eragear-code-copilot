import { describe, expect, test } from "bun:test";
import { CredentialService } from "./credential.service";
import type {
  CredentialStorePort,
  StoredCredential,
} from "./ports/credential-store.port";

class MemoryCredentialStore implements CredentialStorePort {
  readonly credentials: StoredCredential[] = [];

  async read<T>(
    reader: (credentials: readonly StoredCredential[]) => T | Promise<T>
  ): Promise<T> {
    return await reader(this.credentials.map(cloneCredential));
  }

  async mutate<T>(
    mutator: (credentials: StoredCredential[]) => T | Promise<T>
  ): Promise<T> {
    return await mutator(this.credentials);
  }
}

describe("CredentialService", () => {
  test("normalizes and redacts credentials behind the use-case interface", async () => {
    const store = new MemoryCredentialStore();
    let now = 100;
    let nextId = 1;
    const service = new CredentialService(store, {
      createId: () => `cred-${nextId++}`,
      nowMs: () => now,
    });

    const openAi = await service.upsert("user-1", {
      name: " OpenAI ",
      kind: "api_key",
      providerId: " openai ",
      secret: "sk-secret-1234",
      metadata: { scope: "chat" },
    });
    now = 200;
    const anthropic = await service.upsert("user-1", {
      name: "Anthropic",
      kind: "api_key",
      providerId: "anthropic",
      secret: "abcd",
    });

    const all = await service.list("user-1");
    const filtered = await service.list("user-1", { providerId: "anthropic" });

    expect(openAi).toEqual({
      id: "cred-1",
      userId: "user-1",
      name: "OpenAI",
      kind: "api_key",
      providerId: "openai",
      secretPreview: "****1234",
      metadata: { scope: "chat" },
      createdAt: 100,
      updatedAt: 100,
      secretUpdatedAt: 100,
    });
    expect(anthropic.secretPreview).toBe("****");
    expect(all.credentials.map((credential) => credential.id)).toEqual([
      "cred-2",
      "cred-1",
    ]);
    expect(filtered).toEqual({ credentials: [anthropic], totalCount: 1 });
    expect(store.credentials[0]?.secret).toBe("sk-secret-1234");
  });

  test("resolves secrets and records last-used time without exposing secret in records", async () => {
    const store = new MemoryCredentialStore();
    let now = 100;
    const service = new CredentialService(store, {
      createId: () => "cred-1",
      nowMs: () => now,
    });

    const record = await service.upsert("user-1", {
      name: "MiniMax",
      kind: "api_key",
      providerId: "minimax",
      secret: "minimax-secret",
    });
    now = 300;
    const resolved = await service.resolveSecret("user-1", {
      providerId: "minimax",
      kind: "api_key",
    });
    const listed = await service.list("user-1");

    expect(resolved?.secret).toBe("minimax-secret");
    expect(resolved?.credential).toEqual({
      ...record,
      lastUsedAt: 300,
    });
    expect("secret" in (resolved?.credential ?? {})).toBe(false);
    expect(listed.credentials[0]?.lastUsedAt).toBe(300);
  });

  test("enforces credential ownership for updates and deletes", async () => {
    const store = new MemoryCredentialStore();
    const service = new CredentialService(store, {
      createId: () => "cred-1",
      nowMs: () => 100,
    });

    const record = await service.upsert("user-1", {
      name: "Z.ai",
      kind: "api_key",
      providerId: "zai",
      secret: "zai-secret",
    });

    await expect(
      service.upsert("user-2", {
        id: record.id,
        name: "Z.ai",
        kind: "api_key",
        providerId: "zai",
        secret: "replacement",
      })
    ).rejects.toThrow("Credential not found");
    await expect(service.delete("user-2", { id: record.id })).rejects.toThrow(
      "Credential not found"
    );
    await expect(
      service.resolveSecret("user-2", { id: record.id })
    ).resolves.toBeNull();

    await expect(service.delete("user-1", { id: record.id })).resolves.toEqual({
      deleted: true,
    });
    await expect(service.list("user-1")).resolves.toEqual({
      credentials: [],
      totalCount: 0,
    });
  });
});

function cloneCredential(credential: StoredCredential): StoredCredential {
  return {
    ...credential,
    ...(credential.metadata ? { metadata: { ...credential.metadata } } : {}),
  };
}
