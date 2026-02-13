import { describe, expect, test } from "bun:test";
import { ENV } from "@/config/environment";
import {
  createAuthContextResolver,
  resetAuthResolutionRateLimitForTests,
} from "./guards";

function createAuthServiceStub(input?: {
  getSession?: () => unknown;
  verifyApiKey?: () => unknown;
}) {
  let getSessionCalls = 0;
  let verifyApiKeyCalls = 0;
  const service = {
    api: {
      getSession() {
        getSessionCalls += 1;
        return Promise.resolve(input?.getSession?.() ?? null);
      },
      verifyApiKey() {
        verifyApiKeyCalls += 1;
        return Promise.resolve(input?.verifyApiKey?.() ?? null);
      },
    },
  };
  return {
    service,
    getSessionCalls: () => getSessionCalls,
    verifyApiKeyCalls: () => verifyApiKeyCalls,
  };
}

describe("auth guards", () => {
  test("resolves session auth context from request headers", async () => {
    resetAuthResolutionRateLimitForTests();
    const authStub = createAuthServiceStub({
      getSession: () => ({
        user: { id: "user-1" },
        session: { id: "session-1" },
      }),
    });
    const resolver = createAuthContextResolver(authStub.service);

    const result = await resolver({
      headers: new Headers({
        cookie: "better-auth.session_token=session-token",
      }),
    });

    expect(result).toEqual({
      type: "session",
      userId: "user-1",
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
    expect(authStub.getSessionCalls()).toBe(1);
    expect(authStub.verifyApiKeyCalls()).toBe(0);
  });

  test("rate-limits repeated auth resolution attempts for same session token", async () => {
    resetAuthResolutionRateLimitForTests();
    const originalEnabled = ENV.authApiKeyRateLimitEnabled;
    const originalWindowMs = ENV.authApiKeyRateLimitTimeWindowMs;
    const originalMaxRequests = ENV.authApiKeyRateLimitMaxRequests;
    const originalTrustedProxyIps = [...ENV.authTrustedProxyIps];
    ENV.authApiKeyRateLimitEnabled = true;
    ENV.authApiKeyRateLimitTimeWindowMs = 60_000;
    ENV.authApiKeyRateLimitMaxRequests = 2;
    ENV.authTrustedProxyIps = [];

    try {
      const authStub = createAuthServiceStub();
      const resolver = createAuthContextResolver(authStub.service);
      const request = {
        headers: new Headers({
          cookie: "better-auth.session_token=shared-session-token",
        }),
      };

      const first = await resolver(request);
      const second = await resolver(request);
      const third = await resolver(request);

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(third).toBeNull();
      expect(authStub.getSessionCalls()).toBe(2);
    } finally {
      ENV.authApiKeyRateLimitEnabled = originalEnabled;
      ENV.authApiKeyRateLimitTimeWindowMs = originalWindowMs;
      ENV.authApiKeyRateLimitMaxRequests = originalMaxRequests;
      ENV.authTrustedProxyIps = originalTrustedProxyIps;
      resetAuthResolutionRateLimitForTests();
    }
  });

  test("ignores forwarded client IP when remote address is not trusted proxy", async () => {
    resetAuthResolutionRateLimitForTests();
    const originalEnabled = ENV.authApiKeyRateLimitEnabled;
    const originalWindowMs = ENV.authApiKeyRateLimitTimeWindowMs;
    const originalMaxRequests = ENV.authApiKeyRateLimitMaxRequests;
    const originalTrustedProxyIps = [...ENV.authTrustedProxyIps];
    ENV.authApiKeyRateLimitEnabled = true;
    ENV.authApiKeyRateLimitTimeWindowMs = 60_000;
    ENV.authApiKeyRateLimitMaxRequests = 1;
    ENV.authTrustedProxyIps = ["10.10.10.10"];

    try {
      const authStub = createAuthServiceStub();
      const resolver = createAuthContextResolver(authStub.service);

      await resolver({
        headers: new Headers({
          "x-forwarded-for": "203.0.113.1",
        }),
        remoteAddress: "198.51.100.2",
      });
      await resolver({
        headers: new Headers({
          "x-forwarded-for": "203.0.113.2",
        }),
        remoteAddress: "198.51.100.2",
      });

      expect(authStub.getSessionCalls()).toBe(1);
    } finally {
      ENV.authApiKeyRateLimitEnabled = originalEnabled;
      ENV.authApiKeyRateLimitTimeWindowMs = originalWindowMs;
      ENV.authApiKeyRateLimitMaxRequests = originalMaxRequests;
      ENV.authTrustedProxyIps = originalTrustedProxyIps;
      resetAuthResolutionRateLimitForTests();
    }
  });

  test("uses forwarded client IP when remote address is trusted proxy", async () => {
    resetAuthResolutionRateLimitForTests();
    const originalEnabled = ENV.authApiKeyRateLimitEnabled;
    const originalWindowMs = ENV.authApiKeyRateLimitTimeWindowMs;
    const originalMaxRequests = ENV.authApiKeyRateLimitMaxRequests;
    const originalTrustedProxyIps = [...ENV.authTrustedProxyIps];
    ENV.authApiKeyRateLimitEnabled = true;
    ENV.authApiKeyRateLimitTimeWindowMs = 60_000;
    ENV.authApiKeyRateLimitMaxRequests = 1;
    ENV.authTrustedProxyIps = ["10.10.10.10"];

    try {
      const authStub = createAuthServiceStub();
      const resolver = createAuthContextResolver(authStub.service);

      await resolver({
        headers: new Headers({
          "x-forwarded-for": "203.0.113.1",
        }),
        remoteAddress: "10.10.10.10",
      });
      await resolver({
        headers: new Headers({
          "x-forwarded-for": "203.0.113.2",
        }),
        remoteAddress: "10.10.10.10",
      });

      expect(authStub.getSessionCalls()).toBe(2);
    } finally {
      ENV.authApiKeyRateLimitEnabled = originalEnabled;
      ENV.authApiKeyRateLimitTimeWindowMs = originalWindowMs;
      ENV.authApiKeyRateLimitMaxRequests = originalMaxRequests;
      ENV.authTrustedProxyIps = originalTrustedProxyIps;
      resetAuthResolutionRateLimitForTests();
    }
  });
});
