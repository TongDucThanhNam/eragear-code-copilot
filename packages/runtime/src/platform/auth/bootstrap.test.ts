import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuthRuntime } from "./auth";

interface FakeAuthOptions {
  persistedKey: string;
  persistedKeyValid: boolean;
}

function createFakeRuntime(options: FakeAuthOptions) {
  const calls = {
    createApiKey: 0,
    verifyApiKey: 0,
  };
  const authState = {
    hasUsers: true,
    adminUserId: "admin-1",
    adminUsername: "admin",
    bootstrapApiKey: null as string | null,
  };
  const runtime = {
    authDb: {
      prepare() {
        return {
          get() {
            return { count: 1, id: "admin-1" };
          },
        };
      },
    },
    authState,
    auth: {
      api: {
        verifyApiKey(input: { body: { key: string } }) {
          calls.verifyApiKey += 1;
          return Promise.resolve({
            valid:
              options.persistedKeyValid &&
              input.body.key === options.persistedKey,
            key: options.persistedKeyValid ? { userId: "admin-1" } : undefined,
          });
        },
        createApiKey() {
          calls.createApiKey += 1;
          return Promise.resolve({ key: "eg_recovered_bootstrap_key" });
        },
      },
    },
  } as unknown as AuthRuntime;

  return { authState, calls, runtime };
}

describe("ensureBootstrapApiKey", () => {
  const originalProcessAuthDbPath = process.env.AUTH_DB_PATH;
  const originalAllowInsecureDefaults = process.env.ALLOW_INSECURE_DEV_DEFAULTS;
  const originalStrictAllowlist = process.env.CONFIG_STRICT_ALLOWLIST;
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "eragear-bootstrap-key-"));
    const authDbPath = path.join(tempDir, "auth.sqlite");
    process.env.AUTH_DB_PATH = authDbPath;
    process.env.ALLOW_INSECURE_DEV_DEFAULTS = "true";
    process.env.CONFIG_STRICT_ALLOWLIST = "false";
  });

  afterEach(async () => {
    if (originalProcessAuthDbPath === undefined) {
      process.env.AUTH_DB_PATH = undefined;
    } else {
      process.env.AUTH_DB_PATH = originalProcessAuthDbPath;
    }
    if (originalAllowInsecureDefaults === undefined) {
      process.env.ALLOW_INSECURE_DEV_DEFAULTS = undefined;
    } else {
      process.env.ALLOW_INSECURE_DEV_DEFAULTS = originalAllowInsecureDefaults;
    }
    if (originalStrictAllowlist === undefined) {
      process.env.CONFIG_STRICT_ALLOWLIST = undefined;
    } else {
      process.env.CONFIG_STRICT_ALLOWLIST = originalStrictAllowlist;
    }
    await rm(tempDir, { force: true, recursive: true });
  });

  test("reuses a persisted key only after successful verification", async () => {
    const persistedKey = "eg_existing_bootstrap_key";
    await writeFile(
      path.join(tempDir, "api-key.json"),
      JSON.stringify({ key: persistedKey }),
      "utf8"
    );
    const { authState, calls, runtime } = createFakeRuntime({
      persistedKey,
      persistedKeyValid: true,
    });
    const { ensureBootstrapApiKey } = await import("./bootstrap");

    await ensureBootstrapApiKey(runtime, {
      authApiKeyPrefix: "eg_",
      authBootstrapApiKey: true,
    });

    expect(calls.verifyApiKey).toBe(1);
    expect(calls.createApiKey).toBe(0);
    expect(authState.bootstrapApiKey).toBe(persistedKey);
  });

  test("replaces a stale file even when the database already contains keys", async () => {
    const persistedKey = "eg_stale_bootstrap_key";
    await writeFile(
      path.join(tempDir, "api-key.json"),
      JSON.stringify({ key: persistedKey }),
      "utf8"
    );
    const { authState, calls, runtime } = createFakeRuntime({
      persistedKey,
      persistedKeyValid: false,
    });
    const { ensureBootstrapApiKey } = await import("./bootstrap");

    await ensureBootstrapApiKey(runtime, {
      authApiKeyPrefix: "eg_",
      authBootstrapApiKey: true,
    });

    const stored = JSON.parse(
      await readFile(path.join(tempDir, "api-key.json"), "utf8")
    ) as { key?: string };
    expect(calls.verifyApiKey).toBe(1);
    expect(calls.createApiKey).toBe(1);
    expect(stored.key).toBe("eg_recovered_bootstrap_key");
    expect(authState.bootstrapApiKey).toBe("eg_recovered_bootstrap_key");
  });
});
