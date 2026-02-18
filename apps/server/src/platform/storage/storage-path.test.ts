import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getStorageDirPathSync,
  getStoragePathResolutionInfo,
  resetStoragePathCacheForTests,
} from "./storage-path";

describe("storage-path network guard", () => {
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

  test("accepts local paths even when folder name contains sync keywords", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const riskyDir = path.join(baseDir, "OneDrive", "EragearData");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    try {
      process.env.ERAGEAR_STORAGE_DIR = riskyDir;
      resetStoragePathCacheForTests();

      const resolved = getStorageDirPathSync();
      const resolution = getStoragePathResolutionInfo();

      expect(resolved).toBe(path.resolve(riskyDir));
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

  test("fails fast when ERAGEAR_STORAGE_DIR points to mount-risk path", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const riskyDir = path.join(baseDir, "gvfs", "remote");
    const xdgConfigHome = path.join(baseDir, "safe-config-home");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    const prevXdgConfig = process.env.XDG_CONFIG_HOME;
    try {
      process.env.ERAGEAR_STORAGE_DIR = riskyDir;
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      resetStoragePathCacheForTests();

      expect(() => getStorageDirPathSync()).toThrow(
        "ERAGEAR_STORAGE_DIR points to a risky path"
      );
      expect(getStoragePathResolutionInfo()).toBeNull();
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      if (prevXdgConfig === undefined) {
        Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME");
      } else {
        process.env.XDG_CONFIG_HOME = prevXdgConfig;
      }
      resetStoragePathCacheForTests();
    }
  });
});
