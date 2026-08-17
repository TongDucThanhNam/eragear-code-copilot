import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resolveDesktopDistribution } from "./desktop-distribution.js";

const FILE_URL_PATTERN = /^file:\/\//;

describe("resolveDesktopDistribution", () => {
  test("keeps development on the Vite renderer and source runtime", () => {
    const repoRoot = path.resolve("workspace");
    const result = resolveDesktopDistribution({
      appPath: path.join(repoRoot, "apps", "desktop"),
      developmentRendererUrl: "http://127.0.0.1:3001",
      isPackaged: false,
      platform: "win32",
      repoRoot,
      resourcesPath: path.resolve("electron", "resources"),
    });

    expect(result).toEqual({
      rendererUrl: "http://127.0.0.1:3001",
      runtimeRoot: path.join(repoRoot, "packages", "runtime"),
    });
  });

  test("resolves the packaged renderer and Windows runtime sidecar", () => {
    const resourcesPath = path.resolve("install", "resources");
    const appPath = path.join(resourcesPath, "app.asar");
    const result = resolveDesktopDistribution({
      appPath,
      developmentRendererUrl: "http://127.0.0.1:3001",
      isPackaged: true,
      platform: "win32",
      repoRoot: path.resolve("workspace"),
      resourcesPath,
    });

    expect(result.rendererUrl).toMatch(FILE_URL_PATTERN);
    expect(decodeURIComponent(new URL(result.rendererUrl).pathname)).toContain(
      "app.asar/dist/renderer/index.html"
    );
    expect(result.runtimeRoot).toBe(path.join(resourcesPath, "runtime"));
    expect(result.runtimeExecutable).toBe(
      path.join(resourcesPath, "runtime", "eragear-runtime.exe")
    );
  });

  test("honors an explicit packaged runtime executable", () => {
    const override = path.resolve("custom", "runtime.exe");
    const result = resolveDesktopDistribution({
      appPath: path.resolve("install", "resources", "app.asar"),
      developmentRendererUrl: "http://127.0.0.1:3001",
      isPackaged: true,
      platform: "win32",
      repoRoot: path.resolve("workspace"),
      resourcesPath: path.resolve("install", "resources"),
      runtimeExecutableOverride: override,
    });

    expect(result.runtimeExecutable).toBe(override);
  });
});
