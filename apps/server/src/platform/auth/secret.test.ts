import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV } from "@/config/environment";
import { getAuthSecret } from "./secret";

const SECRET_CREATE_ERROR_RE = /Failed to read or create auth secret/i;

describe("getAuthSecret", () => {
  const originalAuthSecret = ENV.authSecret;
  const originalAuthDbPath = ENV.authDbPath;
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "eragear-auth-secret-"));
    ENV.authSecret = undefined;
    ENV.authDbPath = path.join(tmpDir, "auth.sqlite");
  });

  afterEach(async () => {
    ENV.authSecret = originalAuthSecret;
    ENV.authDbPath = originalAuthDbPath;
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns persisted secret when file already exists", async () => {
    const persistedSecret = "a".repeat(64);
    await writeFile(path.join(tmpDir, "auth.secret"), persistedSecret, "utf8");

    expect(getAuthSecret()).toBe(persistedSecret);
  });

  test("throws when secret file exists but remains invalid after race fallback", async () => {
    await writeFile(path.join(tmpDir, "auth.secret"), "short-secret", "utf8");

    expect(() => getAuthSecret()).toThrow(SECRET_CREATE_ERROR_RE);
  });
});
