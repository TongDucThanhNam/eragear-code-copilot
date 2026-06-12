import { describe, expect, test } from "bun:test";
import {
  createRendererContentSecurityPolicy,
  rendererOrigin,
  rendererWebSocketOrigin,
  withRendererContentSecurityPolicyHeaders,
} from "./security.js";

describe("renderer security headers", () => {
  test("allows Vite React dev preamble only for development renderer", () => {
    const csp = createRendererContentSecurityPolicy({
      appIsPackaged: false,
      rendererUrl: "http://127.0.0.1:3002",
    });

    expect(csp).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
    expect(csp).toContain("http://127.0.0.1:3002");
    expect(csp).toContain("ws://127.0.0.1:3002");
  });

  test("keeps packaged script policy free of development allowances", () => {
    const csp = createRendererContentSecurityPolicy({
      appIsPackaged: true,
      rendererUrl: "https://eragear.local",
    });

    expect(csp).toContain("script-src 'self' https://eragear.local");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  test("derives HTTP and WebSocket origins from renderer URL", () => {
    expect(rendererOrigin("http://localhost:5173/app")).toBe(
      "http://localhost:5173"
    );
    expect(rendererWebSocketOrigin("https://example.test/app")).toBe(
      "wss://example.test"
    );
  });

  test("replaces existing CSP headers case-insensitively", () => {
    const headers = withRendererContentSecurityPolicyHeaders(
      {
        "content-security-policy": ["script-src old"],
        "Content-Security-Policy": ["script-src older"],
        "x-test": ["ok"],
      },
      "script-src new"
    );

    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toEqual(["script-src new"]);
    expect(headers["x-test"]).toEqual(["ok"]);
  });
});
