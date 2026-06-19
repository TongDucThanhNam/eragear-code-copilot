import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getStorageDirPathSync,
  getStoragePathResolutionInfo,
  resetStoragePathCacheForTests,
  setStorageFsTypeOverrideForTests,
} from "./storage-path";

describe("storage-path network guard", () => {
  const LOCAL_FS_TYPE = 0xef_53;
  const NETWORK_FS_TYPE = 0x69_69;
  const UNKNOWN_FS_TYPE = 0x12_34_56_78;

  test("resolves relative ERAGEAR_STORAGE_DIR from server root, not cwd", async () => {
    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    const previousCwd = process.cwd();
    const tempCwd = await mkdtemp(path.join(os.tmpdir(), "eragear-cwd-"));
    const serverRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );

    try {
      process.env.ERAGEAR_STORAGE_DIR = "relative-storage";
      process.chdir(tempCwd);
      resetStoragePathCacheForTests();
      setStorageFsTypeOverrideForTests(LOCAL_FS_TYPE);

      const resolved = getStorageDirPathSync();
      expect(resolved).toBe(path.join(serverRoot, "relative-storage"));
    } finally {
      process.chdir(previousCwd);
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      resetStoragePathCacheForTests();
    }
  });

  test("accepts local filesystem types from allowlist", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const storageDir = path.join(baseDir, "EragearData");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    try {
      process.env.ERAGEAR_STORAGE_DIR = storageDir;
      resetStoragePathCacheForTests();
      setStorageFsTypeOverrideForTests(LOCAL_FS_TYPE);

      const resolved = getStorageDirPathSync();
      const resolution = getStoragePathResolutionInfo();

      expect(resolved).toBe(path.resolve(storageDir));
      expect(resolution?.origin).toBe("env");
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      resetStoragePathCacheForTests();
    }
  });

  test("fails fast when ERAGEAR_STORAGE_DIR points to known network filesystem type", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const storageDir = path.join(baseDir, "storage");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    try {
      process.env.ERAGEAR_STORAGE_DIR = storageDir;
      resetStoragePathCacheForTests();
      setStorageFsTypeOverrideForTests(NETWORK_FS_TYPE);

      expect(() => getStorageDirPathSync()).toThrow(
        "ERAGEAR_STORAGE_DIR points to an unsafe path (unsupported_filesystem_type"
      );
      expect(getStoragePathResolutionInfo()).toBeNull();
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      resetStoragePathCacheForTests();
    }
  });

  test("rejects unknown filesystem type by default", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const storageDir = path.join(baseDir, "storage");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    const prevAllowUnknownFs = process.env.STORAGE_ALLOW_UNKNOWN_FS;
    try {
      process.env.ERAGEAR_STORAGE_DIR = storageDir;
      Reflect.deleteProperty(process.env, "STORAGE_ALLOW_UNKNOWN_FS");
      resetStoragePathCacheForTests();
      setStorageFsTypeOverrideForTests(UNKNOWN_FS_TYPE);

      expect(() => getStorageDirPathSync()).toThrow(
        "ERAGEAR_STORAGE_DIR points to an unsafe path (unknown_filesystem_type"
      );
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      if (prevAllowUnknownFs === undefined) {
        Reflect.deleteProperty(process.env, "STORAGE_ALLOW_UNKNOWN_FS");
      } else {
        process.env.STORAGE_ALLOW_UNKNOWN_FS = prevAllowUnknownFs;
      }
      resetStoragePathCacheForTests();
    }
  });

  test("allows unknown filesystem type with explicit env override", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const storageDir = path.join(baseDir, "storage");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    const prevAllowUnknownFs = process.env.STORAGE_ALLOW_UNKNOWN_FS;
    try {
      process.env.ERAGEAR_STORAGE_DIR = storageDir;
      process.env.STORAGE_ALLOW_UNKNOWN_FS = "true";
      resetStoragePathCacheForTests();
      setStorageFsTypeOverrideForTests(UNKNOWN_FS_TYPE);

      const resolved = getStorageDirPathSync();
      expect(resolved).toBe(path.resolve(storageDir));
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      if (prevAllowUnknownFs === undefined) {
        Reflect.deleteProperty(process.env, "STORAGE_ALLOW_UNKNOWN_FS");
      } else {
        process.env.STORAGE_ALLOW_UNKNOWN_FS = prevAllowUnknownFs;
      }
      resetStoragePathCacheForTests();
    }
  });

  test("allows unknown filesystem type by default on Windows runtime", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const storageDir = path.join(baseDir, "storage");
    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    const prevAllowUnknownFs = process.env.STORAGE_ALLOW_UNKNOWN_FS;

    try {
      process.env.ERAGEAR_STORAGE_DIR = storageDir;
      Reflect.deleteProperty(process.env, "STORAGE_ALLOW_UNKNOWN_FS");
      resetStoragePathCacheForTests();
      setStorageFsTypeOverrideForTests(UNKNOWN_FS_TYPE);

      const resolved = getStorageDirPathSync();
      expect(resolved).toBe(path.resolve(storageDir));
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      if (prevAllowUnknownFs === undefined) {
        Reflect.deleteProperty(process.env, "STORAGE_ALLOW_UNKNOWN_FS");
      } else {
        process.env.STORAGE_ALLOW_UNKNOWN_FS = prevAllowUnknownFs;
      }
      resetStoragePathCacheForTests();
    }
  });
});
