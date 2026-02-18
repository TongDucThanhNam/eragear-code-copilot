import { describe, expect, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileUriToPath } from "./path.util";

describe("fileUriToPath", () => {
  test("returns raw input for non-file URI values", () => {
    expect(fileUriToPath("README.md")).toBe("README.md");
  });

  test("converts valid file URI using runtime-native semantics", () => {
    const samplePath =
      process.platform === "win32"
        ? "C:\\workspace\\repo\\README.md"
        : "/tmp/workspace/repo/README.md";
    const uri = pathToFileURL(samplePath).href;

    expect(fileUriToPath(uri)).toBe(fileURLToPath(uri));
  });

  test("throws for malformed file URI", () => {
    expect(() => fileUriToPath("file://%zz")).toThrow("Invalid file URI");
  });
});
