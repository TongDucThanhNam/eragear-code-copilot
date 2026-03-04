import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetStoragePathCacheForTests } from "./storage-path";

let testStorageDir = "";
let previousStorageDirEnv: string | undefined;
let previousAllowedAgentPoliciesEnv: string | undefined;
let previousAllowedTerminalPoliciesEnv: string | undefined;
let previousAllowedEnvKeysEnv: string | undefined;
let blobStoreModule:
  | typeof import("@/platform/storage/blob-store")
  | undefined;

beforeEach(async () => {
  previousStorageDirEnv = process.env.ERAGEAR_STORAGE_DIR;
  previousAllowedAgentPoliciesEnv = process.env.ALLOWED_AGENT_COMMAND_POLICIES;
  previousAllowedTerminalPoliciesEnv =
    process.env.ALLOWED_TERMINAL_COMMAND_POLICIES;
  previousAllowedEnvKeysEnv = process.env.ALLOWED_ENV_KEYS;

  process.env.ALLOWED_AGENT_COMMAND_POLICIES =
    '[{"command":"/usr/bin/env","allowAnyArgs":true}]';
  process.env.ALLOWED_TERMINAL_COMMAND_POLICIES =
    '[{"command":"/usr/bin/env","allowAnyArgs":true}]';
  process.env.ALLOWED_ENV_KEYS = "PATH,HOME,SHELL,USER,TMPDIR,TMP,TEMP";

  testStorageDir = await mkdtemp(path.join(tmpdir(), "eragear-blob-store-"));
  process.env.ERAGEAR_STORAGE_DIR = testStorageDir;
  resetStoragePathCacheForTests();
  blobStoreModule = await import("@/platform/storage/blob-store");
});

afterEach(async () => {
  if (previousStorageDirEnv === undefined) {
    delete process.env.ERAGEAR_STORAGE_DIR;
  } else {
    process.env.ERAGEAR_STORAGE_DIR = previousStorageDirEnv;
  }
  if (previousAllowedAgentPoliciesEnv === undefined) {
    delete process.env.ALLOWED_AGENT_COMMAND_POLICIES;
  } else {
    process.env.ALLOWED_AGENT_COMMAND_POLICIES =
      previousAllowedAgentPoliciesEnv;
  }
  if (previousAllowedTerminalPoliciesEnv === undefined) {
    delete process.env.ALLOWED_TERMINAL_COMMAND_POLICIES;
  } else {
    process.env.ALLOWED_TERMINAL_COMMAND_POLICIES =
      previousAllowedTerminalPoliciesEnv;
  }
  if (previousAllowedEnvKeysEnv === undefined) {
    delete process.env.ALLOWED_ENV_KEYS;
  } else {
    process.env.ALLOWED_ENV_KEYS = previousAllowedEnvKeysEnv;
  }

  resetStoragePathCacheForTests();
  blobStoreModule = undefined;
  if (testStorageDir) {
    await rm(testStorageDir, { recursive: true, force: true });
  }
});

describe("blob-store out-of-band storage", () => {
  test("stores and reads inline blob payload for owner user", async () => {
    if (!blobStoreModule) {
      throw new Error("blob-store module failed to load in test setup");
    }
    const { storeInlineBlobSync, readStoredBlobForUser } = blobStoreModule;
    const base64 = Buffer.from("hello world", "utf8").toString("base64");
    const ref = storeInlineBlobSync({
      userId: "user-1",
      chatId: "chat-1",
      base64,
      mimeType: "text/plain",
      source: "resource",
    });
    expect(ref).not.toBeNull();
    expect(ref?.url).toMatch(/^\/api\/blobs\//);

    const stored = await readStoredBlobForUser({
      blobId: ref!.id,
      userId: "user-1",
    });
    expect(stored).not.toBeNull();
    expect(stored?.metadata.chatId).toBe("chat-1");
    expect(stored?.metadata.mimeType).toBe("text/plain");
    expect(stored?.payload.toString("utf8")).toBe("hello world");
  });

  test("denies blob access for non-owner user", async () => {
    if (!blobStoreModule) {
      throw new Error("blob-store module failed to load in test setup");
    }
    const { storeInlineBlobSync, readStoredBlobForUser } = blobStoreModule;
    const base64 = Buffer.from("secret", "utf8").toString("base64");
    const ref = storeInlineBlobSync({
      userId: "owner-user",
      chatId: "chat-owner",
      base64,
      mimeType: "text/plain",
      source: "resource",
    });
    expect(ref).not.toBeNull();

    const denied = await readStoredBlobForUser({
      blobId: ref!.id,
      userId: "other-user",
    });
    expect(denied).toBeNull();
  });

  test("rejects invalid base64 payloads", () => {
    if (!blobStoreModule) {
      throw new Error("blob-store module failed to load in test setup");
    }
    const { storeInlineBlobSync } = blobStoreModule;
    const ref = storeInlineBlobSync({
      userId: "user-1",
      chatId: "chat-1",
      base64: "###not-base64###",
      mimeType: "application/octet-stream",
      source: "unknown",
    });
    expect(ref).toBeNull();
  });
});
