import { describe, expect, test } from "bun:test";
import type {
  AuthContext,
  RequestLike,
  TrpcContextDependencies,
} from "./context";
import { createTrpcContext } from "./context";

function createDeps(
  resolveAuthContext: TrpcContextDependencies["resolveAuthContext"]
): TrpcContextDependencies {
  return {
    sessionServices: {} as TrpcContextDependencies["sessionServices"],
    aiServices: {} as TrpcContextDependencies["aiServices"],
    projectServices: {} as TrpcContextDependencies["projectServices"],
    agentServices: {} as TrpcContextDependencies["agentServices"],
    toolingServices: {} as TrpcContextDependencies["toolingServices"],
    settingsServices: {} as TrpcContextDependencies["settingsServices"],
    authServices: {} as TrpcContextDependencies["authServices"],
    appConfig: {} as TrpcContextDependencies["appConfig"],
    resolveAuthContext,
  };
}

function toHeaders(
  headers: Headers | Record<string, string | string[] | undefined>
): Headers {
  if (headers instanceof Headers) {
    return headers;
  }
  return new Headers(headers as Record<string, string>);
}

describe("createTrpcContext", () => {
  test("maps ws connectionParams.cookie to cookie header when missing", async () => {
    let capturedRequest: RequestLike | null = null;
    const expectedAuth: AuthContext = {
      type: "session",
      userId: "user-session",
    };
    const deps = createDeps((request) => {
      capturedRequest = request;
      return expectedAuth;
    });

    const baseRequest: RequestLike = {
      headers: new Headers(),
      url: "ws://localhost:3000/trpc?connectionParams=1",
    };

    const context = await createTrpcContext(deps, {
      req: baseRequest,
      connectionParams: {
        cookie: "better-auth.session_token=session-token",
      },
    });

    expect(context.auth).toEqual(expectedAuth);
    expect(capturedRequest).not.toBeNull();
    expect(toHeaders(capturedRequest?.headers).get("cookie")).toBe(
      "better-auth.session_token=session-token"
    );
  });

  test("maps ws connectionParams.apiKey to x-api-key when missing", async () => {
    let capturedRequest: RequestLike | null = null;
    const expectedAuth: AuthContext = {
      type: "apiKey",
      userId: "user-1",
    };
    const deps = createDeps((request) => {
      capturedRequest = request;
      return expectedAuth;
    });

    const baseRequest: RequestLike = {
      headers: new Headers(),
      url: "ws://localhost:3000/trpc?connectionParams=1",
    };

    const context = await createTrpcContext(deps, {
      req: baseRequest,
      connectionParams: { apiKey: "  eg_test_key  " },
    });

    expect(context.auth).toEqual(expectedAuth);
    expect(capturedRequest).not.toBeNull();
    expect(toHeaders(capturedRequest?.headers).get("x-api-key")).toBe(
      "eg_test_key"
    );
  });

  test("does not override explicit auth headers from handshake", async () => {
    let capturedRequest: RequestLike | null = null;
    const deps = createDeps((request) => {
      capturedRequest = request;
      return {
        type: "apiKey",
        userId: "user-2",
      };
    });

    const baseRequest: RequestLike = {
      headers: new Headers({
        "x-api-key": "eg_header_key",
      }),
      url: "ws://localhost:3000/trpc?connectionParams=1",
    };

    await createTrpcContext(deps, {
      req: baseRequest,
      connectionParams: { apiKey: "eg_connection_params_key" },
    });

    expect(capturedRequest).not.toBeNull();
    expect(toHeaders(capturedRequest?.headers).get("x-api-key")).toBe(
      "eg_header_key"
    );
  });

  test("does not override explicit cookie header from handshake", async () => {
    let capturedRequest: RequestLike | null = null;
    const deps = createDeps((request) => {
      capturedRequest = request;
      return {
        type: "session",
        userId: "user-cookie",
      };
    });

    const baseRequest: RequestLike = {
      headers: new Headers({
        cookie: "better-auth.session_token=from-header",
      }),
      url: "ws://localhost:3000/trpc?connectionParams=1",
    };

    await createTrpcContext(deps, {
      req: baseRequest,
      connectionParams: {
        cookie: "better-auth.session_token=from-connection-params",
      },
    });

    expect(capturedRequest).not.toBeNull();
    expect(toHeaders(capturedRequest?.headers).get("cookie")).toBe(
      "better-auth.session_token=from-header"
    );
  });
});
