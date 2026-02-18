import { describe, expect, test } from "bun:test";
import {
  isJsonBodyParseError,
  parseJsonBodyWithLimit,
  parseSessionPaginationParams,
} from "./helpers";

describe("parseSessionPaginationParams", () => {
  test("clamps limit by runtime-configured max", () => {
    const result = parseSessionPaginationParams(
      {
        limit: "999",
        offset: "2",
      },
      17
    );
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.pagination).toEqual({
      limit: 17,
      offset: 2,
    });
  });
});

describe("parseJsonBodyWithLimit", () => {
  test("parses JSON payload within limit", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ name: "ok" }),
      headers: { "content-type": "application/json" },
    });

    const result = await parseJsonBodyWithLimit<{ name: string }>(request, 128);
    expect(result.name).toBe("ok");
  });

  test("fails with 400 on invalid JSON", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: "{bad json",
      headers: { "content-type": "application/json" },
    });

    try {
      await parseJsonBodyWithLimit(request, 128);
      throw new Error("Expected JSON parse error");
    } catch (error) {
      expect(isJsonBodyParseError(error)).toBe(true);
      expect((error as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  test("fails with 413 when payload exceeds configured limit", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ data: "x".repeat(256) }),
      headers: { "content-type": "application/json" },
    });

    try {
      await parseJsonBodyWithLimit(request, 64);
      throw new Error("Expected payload too large error");
    } catch (error) {
      expect(isJsonBodyParseError(error)).toBe(true);
      expect((error as { statusCode?: number }).statusCode).toBe(413);
    }
  });
});
