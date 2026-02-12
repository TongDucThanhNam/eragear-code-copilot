import { describe, expect, test } from "bun:test";
import {
  createAuthContextResolverWithBootstrap,
  type AuthBootstrapRequestLike,
} from "./auth-context.bootstrap";

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
    let nowMs = 1_000;
    let ensureCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: async () => {
          ensureCalls += 1;
        },
      },
      {
        ensureUserDefaultsTtlMs: 1_000,
        now: () => nowMs,
      }
    );

    await resolver(createRequest());
    nowMs = 1_500;
    await resolver(createRequest());
    expect(ensureCalls).toBe(1);
  });

  test("re-runs bootstrap after ttl expires", async () => {
    let nowMs = 10_000;
    let ensureCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: async () => {
          ensureCalls += 1;
        },
      },
      {
        ensureUserDefaultsTtlMs: 1_000,
        now: () => nowMs,
      }
    );

    await resolver(createRequest());
    nowMs = 11_001;
    await resolver(createRequest());
    expect(ensureCalls).toBe(2);
  });

  test("does not cache failed ensureUserDefaults call", async () => {
    let ensureCalls = 0;
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "user-1" }),
        ensureUserDefaults: async () => {
          ensureCalls += 1;
          if (ensureCalls === 1) {
            throw new Error("db unavailable");
          }
        },
      },
      {
        ensureUserDefaultsTtlMs: 1_000,
      }
    );

    await expect(resolver(createRequest())).rejects.toThrow(/db unavailable/i);
    await expect(resolver(createRequest())).resolves.toEqual({
      userId: "user-1",
    });
    expect(ensureCalls).toBe(2);
  });

  test("fails fast when authenticated context has empty userId", async () => {
    const resolver = createAuthContextResolverWithBootstrap<TestAuthContext>(
      {
        resolveAuthContext: async () => ({ userId: "   " }),
        ensureUserDefaults: async () => undefined,
      },
      {
        ensureUserDefaultsTtlMs: 1_000,
      }
    );

    await expect(resolver(createRequest())).rejects.toThrow(/empty userId/i);
  });
});
