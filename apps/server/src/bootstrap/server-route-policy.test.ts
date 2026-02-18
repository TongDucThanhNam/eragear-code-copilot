import { describe, expect, test } from "bun:test";
import {
  isPublicApiRoute,
  shouldForwardToRuntimeWriter,
} from "./server-route-policy";

describe("isPublicApiRoute", () => {
  test("keeps health endpoint public", () => {
    expect(isPublicApiRoute("GET", "/api/health")).toBe(true);
  });

  test("keeps API key verification public", () => {
    expect(isPublicApiRoute("POST", "/api/auth/api-key/verify")).toBe(true);
  });

  test("requires auth for API key management endpoints", () => {
    expect(isPublicApiRoute("POST", "/api/auth/api-key/create")).toBe(false);
    expect(isPublicApiRoute("GET", "/api/auth/api-key/list")).toBe(false);
    expect(isPublicApiRoute("PUT", "/api/auth/api-key/update")).toBe(false);
    expect(isPublicApiRoute("DELETE", "/api/auth/api-key/delete")).toBe(false);
    expect(isPublicApiRoute("POST", "/api/auth/api-key/revoke")).toBe(false);
  });

  test("does not allow suffix-based auth bypass patterns", () => {
    expect(
      isPublicApiRoute("POST", "/api/project/delete/api/auth/sign-in")
    ).toBe(false);
    expect(isPublicApiRoute("POST", "/api/auth/sign-in/api/health")).toBe(
      false
    );
  });

  test("does not treat encoded slash path variants as public auth routes", () => {
    expect(isPublicApiRoute("POST", "/api/auth%2Fsign-in")).toBe(false);
    expect(isPublicApiRoute("POST", "/api/auth/sign-in%2Fusername")).toBe(
      false
    );
  });
});

describe("shouldForwardToRuntimeWriter", () => {
  test("forwards mutating non-auth API routes", () => {
    expect(shouldForwardToRuntimeWriter("POST", "/api/sessions/create")).toBe(
      true
    );
  });

  test("never forwards auth and health routes", () => {
    expect(shouldForwardToRuntimeWriter("POST", "/api/auth/sign-in")).toBe(
      false
    );
    expect(shouldForwardToRuntimeWriter("GET", "/api/health")).toBe(false);
  });
});
