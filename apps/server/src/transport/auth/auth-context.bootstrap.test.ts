import { describe, expect, test } from "bun:test";
import {
  type AuthBootstrapRequestLike,
  createAuthContextResolverWithBootstrap,
} from "./auth-context.bootstrap";

const EMPTY_USER_ID_RE = /empty userId/i;

interface TestAuthContext {
  userId: string;
}

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRequest(): AuthBootstrapRequestLike {
  return {
    headers: new Headers(),
    url: "http://localhost/api/test",
  };
}

describe("createAuthContextResolverWithBootstrap", () => {
  test("dedupes concurrent ensureUserDefaults calls per user", async () => {
    const ensureDeferred = createDeferred();
    let ensureCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: async () => {
          ensureCalls += 1;
          await ensureDeferred.promise;
        },
      },
      {
        ensureUserDefaultsTtlMs: 30 * 60 * 1000,
      }
    );

    const first = resolver(createRequest());
    const second = resolver(createRequest());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ensureCalls).toBe(1);

    ensureDeferred.resolve();
    await expect(first).resolves.toEqual({ userId: "user-1" });
    await expect(second).resolves.toEqual({ userId: "user-1" });
  });

  test("uses cached bootstrap success within ttl", async () => {
    let nowMs = 1000;
    let ensureCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: () => {
          ensureCalls += 1;
          return Promise.resolve();
        },
      },
      {
        ensureUserDefaultsTtlMs: 1000,
        now: () => nowMs,
      }
    );

    await resolver(createRequest());
    nowMs = 1500;
    await resolver(createRequest());
    expect(ensureCalls).toBe(1);
  });

  test("re-runs bootstrap after ttl expires", async () => {
    let nowMs = 10_000;
    let ensureCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: () => {
          ensureCalls += 1;
          return Promise.resolve();
        },
      },
      {
        ensureUserDefaultsTtlMs: 1000,
        now: () => nowMs,
      }
    );

    await resolver(createRequest());
    nowMs = 11_001;
    await resolver(createRequest());
    expect(ensureCalls).toBe(2);
  });

  test("does not cache failed ensureUserDefaults call and stays fail-open", async () => {
    let ensureCalls = 0;
    let errorCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: () => {
          ensureCalls += 1;
          if (ensureCalls === 1) {
            return Promise.reject(new Error("db unavailable"));
          }
          return Promise.resolve();
        },
        onEnsureUserDefaultsError: () => {
          errorCalls += 1;
          return Promise.resolve();
        },
      },
      {
        ensureUserDefaultsTtlMs: 1000,
      }
    );

    await expect(resolver(createRequest())).resolves.toEqual({
      userId: "user-1",
    });
    await expect(resolver(createRequest())).resolves.toEqual({
      userId: "user-1",
    });
    expect(ensureCalls).toBe(2);
    expect(errorCalls).toBe(1);
  });

  test("fails fast when authenticated context has empty userId", async () => {
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "   " }),
        ensureUserDefaults: () => Promise.resolve(),
      },
      {
        ensureUserDefaultsTtlMs: 1000,
      }
    );

    await expect(resolver(createRequest())).rejects.toThrow(EMPTY_USER_ID_RE);
  });
});
