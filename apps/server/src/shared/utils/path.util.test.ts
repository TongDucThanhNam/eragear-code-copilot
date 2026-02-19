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

  test("normalizes single-slash file URIs", () => {
    const uri =
      process.platform === "win32"
        ? "file:/C:/workspace/repo/README.md"
        : "file:/tmp/workspace/repo/README.md";

    expect(fileUriToPath(uri)).toBe(fileURLToPath(uri));
  });

  test("accepts localhost file URI host", () => {
    const uri =
      process.platform === "win32"
        ? "file://localhost/C:/workspace/repo/README.md"
        : "file://localhost/tmp/workspace/repo/README.md";

    expect(fileUriToPath(uri)).toBe(fileURLToPath(uri));
  });

  test("rejects non-local file URI host", () => {
    expect(() => fileUriToPath("file://server/share/README.md")).toThrow(
      "Remote file URI hosts are not allowed"
    );
  });

  test("rejects non-absolute file URI syntax", () => {
    expect(() => fileUriToPath("file:README.md")).toThrow("must be absolute");
  });

  test("rejects file URIs with query or hash", () => {
    expect(() => fileUriToPath("file:///tmp/README.md?x=1")).toThrow(
      "Query parameters and fragments are not allowed"
    );
    expect(() => fileUriToPath("file:///tmp/README.md#section")).toThrow(
      "Query parameters and fragments are not allowed"
    );
  });

  test("throws for malformed file URI", () => {
    expect(() => fileUriToPath("file://%zz")).toThrow("Invalid file URI");
  });
});
