import { describe, expect, test } from "bun:test";
import { resolveAuthTrustedOrigins } from "./environment.auth";

describe("resolveAuthTrustedOrigins", () => {
  test("preserves wildcard trusted origins", () => {
    const origins = resolveAuthTrustedOrigins({
      configuredOrigins: ["*"],
      authBaseUrl: "http://localhost:3010",
      wsPort: 3010,
    });

    expect(origins).toEqual(["*"]);
  });

  test("includes common localhost dev origins", () => {
    const origins = resolveAuthTrustedOrigins({
      configuredOrigins: [],
      authBaseUrl: "http://localhost:3010",
      wsPort: 3010,
    });

    expect(origins).toContain("http://localhost:3010");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
    expect(origins).toContain("http://localhost:5173");
  });
});
