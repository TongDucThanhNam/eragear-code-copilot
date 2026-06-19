import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AcpAuthRecordSchema } from "../application/contracts/acp-auth.contract";
import { AcpAuthFileRepository } from "./acp-auth-file.repository";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "eragear-acp-auth-store-"));
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("persists ACP auth provider snapshots and materialized auth files", async () => {
  const repository = new AcpAuthFileRepository({
    filePath: path.join(tempDir, "acp-auth.json"),
    storageRootPath: tempDir,
  });
  const record = AcpAuthRecordSchema.parse({
    userId: "user-1",
    providerId: "codex",
    displayName: "Codex",
    method: "api_key",
    credentialId: "credential-1",
    envKey: "OPENAI_API_KEY",
    authFilePath: "acp-auth/codex/auth.json",
    enabled: true,
    syncStatus: "pending",
    createdAt: 1000,
    updatedAt: 1000,
  });

  await repository.mutate((snapshot) => {
    snapshot.providers.push(record);
  });
  await repository.writeProviderAuthFile(record, {
    version: 1,
    providerId: "codex",
    method: "api_key",
    credentialId: "credential-1",
    updatedAt: "1970-01-01T00:00:01.000Z",
    auth: { type: "api_key", secret: "secret" },
    env: { OPENAI_API_KEY: "secret" },
  });

  const providers = await repository.read((snapshot) => snapshot.providers);
  const stateFile = await readFile(path.join(tempDir, "acp-auth.json"), "utf8");
  const authFile = await readFile(
    path.join(tempDir, "acp-auth", "codex", "auth.json"),
    "utf8"
  );

  expect(providers).toEqual([record]);
  expect(stateFile).toContain('"version": 1');
  expect(stateFile).not.toContain("secret");
  expect(authFile).toContain('"secret": "secret"');
});
