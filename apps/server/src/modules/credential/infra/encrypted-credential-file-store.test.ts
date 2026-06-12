import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EncryptedCredentialFileStore } from "./encrypted-credential-file-store";

let tempDir: string | null = null;

async function makeStore() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "eragear-credentials-"));
  return {
    filePath: path.join(tempDir, "credentials.json"),
    store: new EncryptedCredentialFileStore({
      filePath: path.join(tempDir, "credentials.json"),
      secretProvider: () => "test-secret-test-secret-test-secret-32",
      nowMs: () => 100,
    }),
  };
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("EncryptedCredentialFileStore", () => {
  test("stores encrypted secrets and returns only redacted records", async () => {
    const { filePath, store } = await makeStore();

    const record = await store.upsert("user-1", {
      name: "OpenAI",
      kind: "api_key",
      providerId: "openai",
      secret: "sk-secret-1234",
    });
    const listed = await store.list("user-1");
    const raw = await readFile(filePath, "utf8");

    expect(record.secretPreview).toBe("****1234");
    expect(listed.credentials).toEqual([record]);
    expect(raw).not.toContain("sk-secret-1234");
    expect(raw).toContain("ciphertext");
  });

  test("resolves secrets for application adapters without exposing them in list", async () => {
    const { store } = await makeStore();

    const record = await store.upsert("user-1", {
      name: "MiniMax",
      kind: "api_key",
      providerId: "minimax",
      secret: "minimax-secret",
    });
    const resolved = await store.resolveSecret("user-1", {
      providerId: "minimax",
      kind: "api_key",
    });
    const listed = await store.list("user-1");

    expect(resolved?.secret).toBe("minimax-secret");
    expect(resolved?.credential.id).toBe(record.id);
    expect(listed.credentials[0]?.lastUsedAt).toBe(100);
  });

  test("deletes only credentials owned by the user", async () => {
    const { store } = await makeStore();

    const record = await store.upsert("user-1", {
      name: "Z.ai",
      kind: "api_key",
      providerId: "zai",
      secret: "zai-secret",
    });
    await expect(store.delete("user-2", { id: record.id })).rejects.toThrow(
      "Credential not found"
    );
    const deleted = await store.delete("user-1", { id: record.id });
    const listed = await store.list("user-1");

    expect(deleted).toEqual({ deleted: true });
    expect(listed.credentials).toEqual([]);
  });
});
