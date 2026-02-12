import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getStorageDirPathSync,
  getStoragePathResolutionInfo,
  resetStoragePathCacheForTests,
} from "./storage-path";

describe("storage-path network guard", () => {
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
      expect(resolution?.rejectedPath).toBeUndefined();
    } finally {
      if (prevStorageDir === undefined) {
        Reflect.deleteProperty(process.env, "ERAGEAR_STORAGE_DIR");
      } else {
        process.env.ERAGEAR_STORAGE_DIR = prevStorageDir;
      }
      resetStoragePathCacheForTests();
    }
  });

  test("falls back when ERAGEAR_STORAGE_DIR points to mount-risk path", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "eragear-storage-"));
    const riskyDir = path.join(baseDir, "gvfs", "remote");
    const xdgConfigHome = path.join(baseDir, "safe-config-home");

    const prevStorageDir = process.env.ERAGEAR_STORAGE_DIR;
    const prevXdgConfig = process.env.XDG_CONFIG_HOME;
    try {
      process.env.ERAGEAR_STORAGE_DIR = riskyDir;
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      resetStoragePathCacheForTests();

      const resolved = getStorageDirPathSync();
      const resolution = getStoragePathResolutionInfo();

      expect(resolved).not.toBe(path.resolve(riskyDir));
      expect(resolution?.origin).toBe("fallback_from_network");
      expect(resolution?.rejectedPath).toBe(path.resolve(riskyDir));
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
