import { describe, expect, spyOn, test } from "bun:test";
import {
  isJsonBodyParseError,
  parseJsonBodyWithLimit,
  parseLogQueryParams,
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

  test("falls back to defaults when pagination params are invalid", () => {
    const result = parseSessionPaginationParams(
      {
        limit: "nope",
        offset: "-3",
      },
      17
    );
    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.pagination).toEqual({
      limit: 200,
      offset: 0,
    });
  });
});

describe("parseLogQueryParams", () => {
  test("parses acpOnly and source filters", () => {
    const result = parseLogQueryParams({
      acpOnly: "true",
      sources: "acp,console",
      levels: "debug,info",
      order: "desc",
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.query.acpOnly).toBe(true);
    expect(result.query.sources).toEqual(["acp", "console"]);
    expect(result.query.levels).toEqual(["debug", "info"]);
  });

  test("derives from timestamp from semantic range on the server", () => {
    const nowSpy = spyOn(Date, "now").mockReturnValue(2_000_000);
    try {
      const result = parseLogQueryParams({
        range: "30m",
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      expect(result.query.from).toBe(2_000_000 - 30 * 60 * 1000);
      expect(result.query.to).toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("rejects mixing semantic range with explicit timestamps", () => {
    const result = parseLogQueryParams({
      range: "2h",
      from: "123",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("range");
  });

  test("rejects invalid acpOnly value", () => {
    const result = parseLogQueryParams({
      acpOnly: "maybe",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("acpOnly");
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
