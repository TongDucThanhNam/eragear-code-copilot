import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { resetStoragePathCacheForTests } from "@/platform/storage/storage-path";

let testStorageDir = "";
let previousStorageDirEnv: string | undefined;
let previousAllowedAgentPoliciesEnv: string | undefined;
let previousAllowedTerminalPoliciesEnv: string | undefined;
let previousAllowedEnvKeysEnv: string | undefined;
let contentBlockUtilModule: typeof import("./content-block.util") | undefined;

// Top-level regex patterns for performance
const BLOB_ID_PATTERN = /^blob-/;
const BLOB_URI_PATTERN = /^\/api\/blobs\/blob-/;

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
  testStorageDir = await mkdtemp(
    path.join(tmpdir(), "eragear-content-block-util-")
  );
  process.env.ERAGEAR_STORAGE_DIR = testStorageDir;
  resetStoragePathCacheForTests();
  contentBlockUtilModule = await import("./content-block.util");
});

afterEach(async () => {
  if (previousStorageDirEnv === undefined) {
    // biome-ignore: Setting to undefined is intentional for unsetting env vars
    process.env.ERAGEAR_STORAGE_DIR = undefined;
  } else {
    process.env.ERAGEAR_STORAGE_DIR = previousStorageDirEnv;
  }
  if (previousAllowedAgentPoliciesEnv === undefined) {
    // biome-ignore: Setting to undefined is intentional for unsetting env vars
    process.env.ALLOWED_AGENT_COMMAND_POLICIES = undefined;
  } else {
    process.env.ALLOWED_AGENT_COMMAND_POLICIES =
      previousAllowedAgentPoliciesEnv;
  }
  if (previousAllowedTerminalPoliciesEnv === undefined) {
    // biome-ignore: Setting to undefined is intentional for unsetting env vars
    process.env.ALLOWED_TERMINAL_COMMAND_POLICIES = undefined;
  } else {
    process.env.ALLOWED_TERMINAL_COMMAND_POLICIES =
      previousAllowedTerminalPoliciesEnv;
  }
  if (previousAllowedEnvKeysEnv === undefined) {
    // biome-ignore: Setting to undefined is intentional for unsetting env vars
    process.env.ALLOWED_ENV_KEYS = undefined;
  } else {
    process.env.ALLOWED_ENV_KEYS = previousAllowedEnvKeysEnv;
  }
  resetStoragePathCacheForTests();
  contentBlockUtilModule = undefined;
  if (testStorageDir) {
    await rm(testStorageDir, { recursive: true, force: true });
  }
});

describe("toStoredContentBlock inline binary guard", () => {
  test("normalizes resource_link bigint size to number", () => {
    if (!contentBlockUtilModule) {
      throw new Error("content-block util module failed to load in test setup");
    }
    const { toStoredContentBlock } = contentBlockUtilModule;
    const block = {
      type: "resource_link",
      uri: "file:///tmp/report.txt",
      name: "report.txt",
      mimeType: "text/plain",
      size: BigInt(12),
    } as unknown as ContentBlock;

    const normalized = toStoredContentBlock(block);
    expect(normalized).toMatchObject({
      type: "resource_link",
      size: 12,
    });
  });

  test("drops oversized image inline base64 payload from stored content", () => {
    if (!contentBlockUtilModule) {
      throw new Error("content-block util module failed to load in test setup");
    }
    const { MAX_INLINE_BINARY_BASE64_CHARS, toStoredContentBlock } =
      contentBlockUtilModule;
    const oversized = "A".repeat(MAX_INLINE_BINARY_BASE64_CHARS + 1);
    const block = {
      type: "image",
      mimeType: "image/png",
      data: oversized,
      uri: "file:///tmp/image.png",
    } as ContentBlock;

    const normalized = toStoredContentBlock(block);
    expect(normalized).toMatchObject({
      type: "image",
      data: "",
    });
    expect((normalized as { _meta?: Record<string, unknown> })._meta).toEqual(
      expect.objectContaining({
        eragearInlineBinary: expect.objectContaining({
          field: "data",
          omitted: true,
          base64Chars: oversized.length,
          maxBase64Chars: MAX_INLINE_BINARY_BASE64_CHARS,
        }),
      })
    );
  });

  test("stores oversized image blob out-of-band when context is provided", () => {
    if (!contentBlockUtilModule) {
      throw new Error("content-block util module failed to load in test setup");
    }
    const { MAX_INLINE_BINARY_BASE64_CHARS, toStoredContentBlock } =
      contentBlockUtilModule;
    const oversized = Buffer.alloc(MAX_INLINE_BINARY_BASE64_CHARS, 7).toString(
      "base64"
    );
    expect(oversized.length).toBeGreaterThan(MAX_INLINE_BINARY_BASE64_CHARS);
    const block = {
      type: "image",
      mimeType: "image/png",
      data: oversized,
    } as ContentBlock;

    const normalized = toStoredContentBlock(block, {
      userId: "user-1",
      chatId: "chat-1",
    });
    expect(normalized).toMatchObject({
      type: "image",
      data: "",
      uri: expect.stringMatching(BLOB_URI_PATTERN),
    });
    expect((normalized as { _meta?: Record<string, unknown> })._meta).toEqual(
      expect.objectContaining({
        eragearInlineBinary: expect.objectContaining({
          field: "data",
          omitted: true,
          blobRef: expect.objectContaining({
            id: expect.stringMatching(BLOB_ID_PATTERN),
            url: expect.stringMatching(BLOB_URI_PATTERN),
          }),
        }),
      })
    );
  });

  test("drops oversized embedded resource blob from stored content", () => {
    if (!contentBlockUtilModule) {
      throw new Error("content-block util module failed to load in test setup");
    }
    const { MAX_INLINE_BINARY_BASE64_CHARS, toStoredContentBlock } =
      contentBlockUtilModule;
    const oversized = "B".repeat(MAX_INLINE_BINARY_BASE64_CHARS + 10);
    const block = {
      type: "resource",
      resource: {
        uri: "file:///tmp/archive.zip",
        mimeType: "application/zip",
        blob: oversized,
      },
    } as ContentBlock;

    const normalized = toStoredContentBlock(block);
    expect(normalized.type).toBe("resource");
    if (normalized.type !== "resource") {
      return;
    }
    expect(
      "blob" in normalized.resource ? normalized.resource.blob : undefined
    ).toBe("");
    expect(
      (
        normalized.resource as {
          _meta?: Record<string, unknown>;
        }
      )._meta
    ).toEqual(
      expect.objectContaining({
        eragearInlineBinary: expect.objectContaining({
          field: "blob",
          omitted: true,
          base64Chars: oversized.length,
          maxBase64Chars: MAX_INLINE_BINARY_BASE64_CHARS,
        }),
      })
    );
  });

  test("stores oversized resource blob out-of-band and rewrites uri", () => {
    if (!contentBlockUtilModule) {
      throw new Error("content-block util module failed to load in test setup");
    }
    const { MAX_INLINE_BINARY_BASE64_CHARS, toStoredContentBlock } =
      contentBlockUtilModule;
    const oversized = Buffer.alloc(MAX_INLINE_BINARY_BASE64_CHARS, 11).toString(
      "base64"
    );
    expect(oversized.length).toBeGreaterThan(MAX_INLINE_BINARY_BASE64_CHARS);
    const block = {
      type: "resource",
      resource: {
        mimeType: "application/octet-stream",
        blob: oversized,
      },
    } as ContentBlock;

    const normalized = toStoredContentBlock(block, {
      userId: "user-2",
      chatId: "chat-2",
    });
    expect(normalized.type).toBe("resource");
    if (normalized.type !== "resource") {
      return;
    }
    expect(normalized.resource.uri).toMatch(BLOB_URI_PATTERN);
    const resourceMeta = (
      normalized.resource as {
        _meta?: Record<string, unknown>;
      }
    )._meta;
    expect(resourceMeta).toEqual(
      expect.objectContaining({
        eragearInlineBinary: expect.objectContaining({
          field: "blob",
          omitted: true,
          blobRef: expect.objectContaining({
            id: expect.stringMatching(BLOB_ID_PATTERN),
            url: expect.stringMatching(BLOB_URI_PATTERN),
          }),
        }),
      })
    );
  });
});
