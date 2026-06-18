import { describe, expect, test } from "bun:test";
import {
  createTrpcAuthRequest,
  type RequestLike,
} from "./context-auth-request";

function toHeaders(
  headers: Headers | Record<string, string | string[] | undefined>
): Headers {
  if (headers instanceof Headers) {
    return headers;
  }
  return new Headers(headers as Record<string, string>);
}

describe("createTrpcAuthRequest", () => {
  test("maps connection param aliases to auth headers", () => {
    const request = createTrpcAuthRequest(
      { headers: new Headers(), url: "ws://localhost/trpc" },
      {
        cookieHeader: " better-auth.session_token=session-token ",
        api_key: " eg_api_key ",
        local_auth_token: " local-token ",
      }
    );

    expect(request).toBeDefined();
    const headers = toHeaders((request as RequestLike).headers);
    expect(headers.get("cookie")).toBe(
      "better-auth.session_token=session-token"
    );
    expect(headers.get("x-api-key")).toBe("eg_api_key");
    expect(headers.get("x-eragear-local-token")).toBe("local-token");
  });

  test("does not override existing auth headers", () => {
    const request = createTrpcAuthRequest(
      {
        headers: new Headers({
          authorization: "Bearer from-header",
          cookie: "better-auth.session_token=from-header",
          "x-eragear-local-token": "local-from-header",
        }),
      },
      {
        cookie: "better-auth.session_token=from-connection",
        apiKey: "eg_connection_key",
        localAuthToken: "local-from-connection",
      }
    );

    expect(request).toBeDefined();
    const headers = toHeaders((request as RequestLike).headers);
    expect(headers.get("authorization")).toBe("Bearer from-header");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("cookie")).toBe("better-auth.session_token=from-header");
    expect(headers.get("x-eragear-local-token")).toBe("local-from-header");
  });

  test("supports record headers without mutating the original request", () => {
    const baseRequest: RequestLike = {
      headers: {
        "x-existing": "kept",
      },
      remoteAddress: "127.0.0.1",
    };

    const request = createTrpcAuthRequest(baseRequest, {
      apikey: "eg_record_key",
    });

    expect(request).toEqual({
      headers: {
        "x-existing": "kept",
        "x-api-key": "eg_record_key",
      },
      remoteAddress: "127.0.0.1",
    });
    expect(baseRequest.headers).toEqual({ "x-existing": "kept" });
  });

  test("returns undefined when no request is available", () => {
    expect(createTrpcAuthRequest(undefined, { apiKey: "eg_key" })).toBe(
      undefined
    );
  });
});
