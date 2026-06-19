import { describe, expect, test } from "bun:test";
import { applyFetchHeadersToNodeResponse } from "./response-headers";

interface MockResponse {
  setHeader: (name: string, value: string | string[]) => void;
  headers: Map<string, string | string[]>;
}

function createMockResponse(): MockResponse {
  const headers = new Map<string, string | string[]>();
  return {
    headers,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
  };
}

describe("applyFetchHeadersToNodeResponse", () => {
  test("preserves multiple Set-Cookie headers as an array", () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/; HttpOnly");
    headers.append("set-cookie", "b=2; Path=/; HttpOnly");
    headers.set("content-type", "application/json");

    const response = createMockResponse();
    applyFetchHeadersToNodeResponse(
      response as unknown as Parameters<
        typeof applyFetchHeadersToNodeResponse
      >[0],
      headers
    );

    const setCookie = response.headers.get("set-cookie");
    expect(Array.isArray(setCookie)).toBe(true);
    expect(setCookie).toEqual([
      "a=1; Path=/; HttpOnly",
      "b=2; Path=/; HttpOnly",
    ]);
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});
