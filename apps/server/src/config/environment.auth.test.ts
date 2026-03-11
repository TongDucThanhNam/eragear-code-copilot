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
    expect(origins).toContain("eragear-code-copilot://");
    expect(origins).toContain("exp://");
  });

  test("does not trust Expo dev prefixes for non-local auth hosts", () => {
    const origins = resolveAuthTrustedOrigins({
      configuredOrigins: [],
      authBaseUrl: "https://code.eragear.app",
      wsPort: 443,
    });

    expect(origins).toContain("eragear-code-copilot://");
    expect(origins).not.toContain("exp://");
  });
});
