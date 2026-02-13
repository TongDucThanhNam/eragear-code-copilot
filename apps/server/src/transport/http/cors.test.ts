import { describe, expect, test } from "bun:test";
import { normalizeOrigin, resolveCorsOrigin } from "./cors";

describe("normalizeOrigin", () => {
  test("normalizes valid http/https origins", () => {
    expect(normalizeOrigin("https://example.com:443/path")).toBe(
      "https://example.com"
    );
    expect(normalizeOrigin("http://localhost:3010")).toBe(
      "http://localhost:3010"
    );
  });

  test("rejects invalid origins", () => {
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("not-a-url")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });
});

describe("resolveCorsOrigin", () => {
  test("does not reflect malformed origins", () => {
    const trustedOrigins = ["http://localhost:3010"];

    expect(
      resolveCorsOrigin("javascript:alert(1)", trustedOrigins, true)
    ).toBeUndefined();
    expect(
      resolveCorsOrigin("not-a-url", trustedOrigins, true)
    ).toBeUndefined();
  });

  test("allows trusted origin", () => {
    expect(
      resolveCorsOrigin(
        "http://localhost:3010",
        ["http://localhost:3010"],
        true
      )
    ).toBe("http://localhost:3010");
  });

  test("denies untrusted origin in strict mode", () => {
    expect(
      resolveCorsOrigin(
        "http://evil.localhost:9999",
        ["http://localhost:3010"],
        true
      )
    ).toBeUndefined();
  });
});
