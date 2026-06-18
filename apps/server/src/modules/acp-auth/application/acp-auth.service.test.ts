import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CredentialRecord } from "@/modules/credential";
import { ValidationError } from "@/shared/errors";
import { AcpAuthFileRepository } from "../di";
import { AcpAuthService } from "./acp-auth.service";
import type { CredentialSecretResolverPort } from "./ports/credential-secret-resolver.port";

let tempDir = "";
let nowMs = 1_800_000_000_000;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "eragear-acp-auth-"));
  nowMs = 1_800_000_000_000;
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("sync materializes provider auth from encrypted credential references", async () => {
  const service = createService({
    cred_codex: "sk-test-codex",
  });

  const saved = await service.upsert("user-a", {
    providerId: "codex",
    displayName: "Codex",
    method: "api_key",
    credentialId: "cred_codex",
    envKey: "openai_api_key",
    metadata: { account: "primary" },
  });
  expect(saved.authFilePath).toBe("acp-auth/codex/auth.json");
  expect(saved.syncStatus).toBe("pending");

  const result = await service.sync("user-a");
  expect(result.totalCount).toBe(1);
  expect(result.errorCount).toBe(0);
  expect(result.providers[0]?.syncStatus).toBe("synced");
  expect(result.providers[0]?.envKey).toBe("OPENAI_API_KEY");

  const authFile = JSON.parse(
    await readFile(path.join(tempDir, "acp-auth", "codex", "auth.json"), "utf8")
  );
  expect(authFile).toMatchObject({
    version: 1,
    providerId: "codex",
    method: "api_key",
    credentialId: "cred_codex",
    auth: { type: "api_key", secret: "sk-test-codex" },
    env: { OPENAI_API_KEY: "sk-test-codex" },
    metadata: { account: "primary" },
  });

  const stateFile = await readFile(path.join(tempDir, "acp-auth.json"), "utf8");
  expect(stateFile).not.toContain("sk-test-codex");
});

test("sync marks missing credentials without materializing auth file", async () => {
  const service = createService({});
  await service.upsert("user-a", {
    providerId: "zai",
    method: "bearer_token",
    credentialId: "missing",
  });

  const result = await service.sync("user-a");

  expect(result.providers[0]?.syncStatus).toBe("missing_credential");
  expect(result.providers[0]?.syncError).toContain("Credential");
  await expect(
    readFile(path.join(tempDir, "acp-auth", "zai", "auth.json"), "utf8")
  ).rejects.toThrow();
});

test("startup sync rehydrates auth files for every stored user", async () => {
  const service = createService({
    cred_codex: "codex-secret",
    cred_zai: "zai-secret",
  });
  await service.upsert("user-a", {
    providerId: "codex",
    method: "api_key",
    credentialId: "cred_codex",
  });
  await service.upsert("user-b", {
    providerId: "zai",
    method: "api_key",
    credentialId: "cred_zai",
  });

  const result = await service.syncStartup();

  expect(result.totalCount).toBe(2);
  expect(
    result.providers.map((provider) => provider.providerId).sort()
  ).toEqual(["codex", "zai"]);
  expect(
    await readFile(path.join(tempDir, "acp-auth", "codex", "auth.json"), "utf8")
  ).toContain("codex-secret");
  expect(
    await readFile(path.join(tempDir, "acp-auth", "zai", "auth.json"), "utf8")
  ).toContain("zai-secret");
});

test("lists tenant auth records in service-owned visibility order", async () => {
  const service = createService({});
  await service.upsert("user-a", {
    providerId: "zulu",
    displayName: "Zulu",
    method: "external_cli",
  });
  await service.upsert("user-a", {
    providerId: "alpha",
    displayName: "Alpha",
    method: "external_cli",
  });
  await service.upsert("user-a", {
    providerId: "disabled",
    displayName: "Disabled",
    method: "external_cli",
    enabled: false,
  });
  await service.upsert("user-b", {
    providerId: "bravo",
    displayName: "Bravo",
    method: "external_cli",
  });

  const visible = await service.list("user-a");
  const all = await service.list("user-a", { includeDisabled: true });

  expect(visible.providers.map((provider) => provider.providerId)).toEqual([
    "alpha",
    "zulu",
  ]);
  expect(all.providers.map((provider) => provider.providerId)).toEqual([
    "alpha",
    "disabled",
    "zulu",
  ]);
});

test("external CLI auth records sync without requiring a credential", async () => {
  const service = createService({});
  await service.upsert("user-a", {
    providerId: "claude",
    method: "external_cli",
  });

  const result = await service.sync("user-a");

  expect(result.providers[0]?.syncStatus).toBe("synced");
  expect(result.providers[0]?.lastSyncedAt).toBe(nowMs);
});

test("delete removes the provider record and materialized auth file", async () => {
  const service = createService({
    cred_codex: "secret",
  });
  await service.upsert("user-a", {
    providerId: "codex",
    method: "api_key",
    credentialId: "cred_codex",
  });
  await service.sync("user-a");

  await service.delete("user-a", { providerId: "codex" });

  await expect(
    readFile(path.join(tempDir, "acp-auth", "codex", "auth.json"), "utf8")
  ).rejects.toThrow();
  expect((await service.list("user-a")).providers).toEqual([]);
});

test("rejects auth file paths outside storage", async () => {
  const service = createService({
    cred_codex: "secret",
  });

  await expect(
    service.upsert("user-a", {
      providerId: "codex",
      method: "api_key",
      credentialId: "cred_codex",
      authFilePath: "../codex/auth.json",
    })
  ).rejects.toBeInstanceOf(ValidationError);
});

function createService(secretsById: Record<string, string>): AcpAuthService {
  const resolver: CredentialSecretResolverPort = {
    resolveSecret: (userId, input) => {
      if (!input.id) {
        return Promise.resolve(null);
      }
      const secret = secretsById[input.id];
      if (!secret) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        credential: credentialRecord(userId, input.id),
        secret,
      });
    },
  };

  return new AcpAuthService({
    repository: new AcpAuthFileRepository({
      filePath: path.join(tempDir, "acp-auth.json"),
      storageRootPath: tempDir,
    }),
    credentialResolver: resolver,
    nowMs: () => nowMs,
  });
}

function credentialRecord(userId: string, id: string): CredentialRecord {
  return {
    id,
    userId,
    name: id,
    kind: "api_key",
    secretPreview: "****test",
    createdAt: nowMs,
    updatedAt: nowMs,
    secretUpdatedAt: nowMs,
  };
}
